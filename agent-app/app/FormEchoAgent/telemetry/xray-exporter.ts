import { type ExportResult, ExportResultCode } from '@opentelemetry/core';
import { JsonTraceSerializer } from '@opentelemetry/otlp-transformer';
import type { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace-base';
import { signedFetch } from '../aws/signed-fetch.js';

/**
 * span を OTLP で CloudWatch（X-Ray）へ送る（#213）。
 *
 * **素の OTLP エクスポータでは届かない** — あのエンドポイントは SigV4 の署名を要求する
 * ので、認証の無い宛先（Jaeger など）向けの `setupTracer({ exporters: { otlp: true } })`
 * は 403 になる。署名は `aws/signed-fetch.ts` が Gateway と共有で持っている。
 *
 * **本文は JSON で送る。** エンドポイントは binary（protobuf）と json の両方を受ける。
 * JSON にすると本文が文字列になり、Gateway と同じ署名経路にそのまま乗る（protobuf の
 * バイト列だと署名側に二値目の分岐が要る）。
 *
 * AWS が配っている ADOT の Node パッケージにも同じ働きのクラスはあるが、`exports` が
 * `./register` 1つに絞られていて個別に import できず、丸ごと読むと使わない LangChain
 * 計装まで抱き込む（詳細は `.claude/rules/agent-app.md`）。
 */
export function xraySpanExporter(endpoint: string): SpanExporter {
  const post = signedFetch('xray');

  return {
    export(spans: ReadableSpan[], resultCallback: (r: ExportResult) => void) {
      const serialized = JsonTraceSerializer.serializeRequest(spans);
      if (serialized === undefined) {
        resultCallback({ code: ExportResultCode.SUCCESS });
        return;
      }
      post(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: new TextDecoder().decode(serialized),
      })
        .then(async (response) => {
          if (response.ok) {
            resultCallback({ code: ExportResultCode.SUCCESS });
            return;
          }
          /*
            送信の失敗をここで必ず1行出す。**この経路は誰も待っていない**
            （`BatchSpanProcessor` が裏で呼ぶ）ので、黙って落ちると
            「画面は正常、トレースだけ永久に出ない」状態が何も言わずに続く。
            権限不足やリージョン違いはここにしか現れない。
          */
          const detail = await response.text().catch(() => '');
          console.error(
            `[telemetry] span の送信に失敗しました: ${response.status} ${detail.slice(0, 200)}`,
          );
          resultCallback({
            code: ExportResultCode.FAILED,
            error: new Error(`span の送信に失敗しました: ${response.status}`),
          });
        })
        .catch((error: unknown) => {
          console.error(
            `[telemetry] span の送信に失敗しました: ${String(error)}`,
          );
          resultCallback({
            code: ExportResultCode.FAILED,
            error: error instanceof Error ? error : new Error(String(error)),
          });
        });
    },
    shutdown() {
      return Promise.resolve();
    },
    forceFlush() {
      return Promise.resolve();
    },
  };
}
