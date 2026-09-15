import { AWSXRayIdGenerator } from '@opentelemetry/id-generator-aws-xray';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { resolveTracesEndpoint } from '../config.js';
import { xraySpanExporter } from './xray-exporter.js';

/**
 * GenAI Observability の画面に出る名前。
 *
 * **`OTEL_RESOURCE_ATTRIBUTES` では渡さない。** あの環境変数は AgentCore がホスト時に
 * 入れる `aws.log.group.names` と `cloud.resource_id`（ダッシュボードへの紐付けそのもの）
 * を丸ごと上書きしてしまう。
 */
const SERVICE_NAME = 'FormEchoAgent';

/**
 * トレースを有効にする（#213）。**送り先が無ければ何もしない。**
 *
 * Strands は span を自分で発行し、**グローバルに登録済みの TracerProvider を黙って使う**
 * （ドキュメントが挙げる「自前の provider を登録する」形）。
 *
 * **`setupTracer()` は呼ばない。** あれに自前のエクスポータを渡す口は無く
 * （`exporters` は `otlp` / `console` の真偽値2つだけ）、`otlp: true` が作るのは署名しない
 * `OTLPTraceExporter` なので SigV4 必須の AWS 宛では 403 になる。渡せるのは provider 丸ごと
 * だけだが、その経路は `setGlobalTracerProvider` を呼んで即 return し、コンテキスト
 * マネージャもプロパゲータも設定しない — `provider.register()` はその3つを全部やるので、
 * 置き換えるとむしろ機能が減る。
 *
 * `AWSXRayIdGenerator` を使うのは、X-Ray が trace ID の先頭4バイトに epoch 秒を要求する
 * ため。標準の乱数 ID のままだと送信自体は通っても取り込みで弾かれる。
 */
export function setupTracing(): void {
  const endpoint = resolveTracesEndpoint();
  if (endpoint === null) return;

  const provider = new NodeTracerProvider({
    idGenerator: new AWSXRayIdGenerator(),
    resource: resourceFromAttributes({ 'service.name': SERVICE_NAME }),
    spanProcessors: [new BatchSpanProcessor(xraySpanExporter(endpoint))],
  });
  provider.register();

  /*
    終了前に送り切る（`setupTracer()` の非カスタム経路が持っているのと同じフック）。
    **AgentCore Runtime は invocation ごとにプロセスを立て直す**ので、
    `BatchSpanProcessor` の既定5秒周期が回る前に落ちた回は span が丸ごと消える。
    処理が数秒で終わった回ほど失われやすい。

    `beforeExit` はシグナルでの停止では発火しないため、これで全部は救えない。
    取りこぼしが実際に出たら周期を縮めるか、invocation の終わりで flush する。
  */
  process.once('beforeExit', () => {
    provider.forceFlush().catch((error: unknown) => {
      console.error(`[telemetry] 終了前の送信に失敗しました: ${String(error)}`);
    });
  });
}
