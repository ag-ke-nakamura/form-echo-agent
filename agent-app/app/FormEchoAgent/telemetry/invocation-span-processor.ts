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
    if (attributes.requestId !== undefined) {
      // AgentCore サービス側の span と同じ値。1回の呼び出しが2トレースに分かれる
      // （どちらも LOCAL_ROOT で、AWS 側がそういう設計）ので、対応付けはこれで取る。
      span.setAttribute('aws.request.id', attributes.requestId);
    }
  },
  onEnd(): void {},
  forceFlush(): Promise<void> {
    return Promise.resolve();
  },
  shutdown(): Promise<void> {
    return Promise.resolve();
  },
};
