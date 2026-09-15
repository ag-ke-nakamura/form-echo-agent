import type { Span } from '@opentelemetry/sdk-trace-base';
import { currentInvocationAttributes } from './invocation-attributes.js';

/**
 * 進行中の invocation の値を**全ての span** に貼る（#213）。
 *
 * 貼らないと GenAI Observability のセッション画面が `invoke_agent` しか拾わず、
 * 思考の各周・モデル呼び出し・ツール実行が紐付かない（Strands が
 * `traceAttributes` を親 span にしか付けないため）。
 *
 * **`onStart` で貼る。** span は開始後・終了前しか属性を受け付けない。
 *
 * 文脈が無いとき（起動時や、invocation の外で誰かが span を張ったとき）は何もしない。
 * ここで投げると**トレースを出したいだけでリクエストを落とす**ことになる。
 */
export const invocationSpanProcessor = {
  onStart(span: Span): void {
    const attributes = currentInvocationAttributes();
    if (attributes === undefined) return;
    span.setAttribute('session.id', attributes.sessionId);
    span.setAttribute('formecho.task_id', attributes.taskId);
    /*
      **`aws.request.id` は貼らない**（#213）。AgentCore サービス側の span が持つ
      あの値と揃えてターン単位で対応づけたかったが、**揃わない**ことを実機で確認した。
      `bedrock-agentcore` は `x-amzn-bedrock-agentcore-runtime-request-id` が
      無ければランダム UUID を入れる実装で、そのヘッダは届いていない。
      無関係な値を AWS の予約キーに入れると、後で結合しようとした人を誤らせる。

      対応づけたいなら `session.id` と時刻で辿る。1回の呼び出しが2トレースに
      分かれること自体は AWS 側の設計（どちらの span も LOCAL_ROOT）。
    */
  },
  onEnd(): void {},
  forceFlush(): Promise<void> {
    return Promise.resolve();
  },
  shutdown(): Promise<void> {
    return Promise.resolve();
  },
};
