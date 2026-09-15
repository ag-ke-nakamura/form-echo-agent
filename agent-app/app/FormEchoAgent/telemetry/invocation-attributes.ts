import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * 1回の invocation を通して span に貼る値（#213）。
 *
 * **Strands の `traceAttributes` では運べない。** あれは Agent の生成時に固定されるが、
 * Agent はセッション単位でキャッシュされる（会話履歴を保つため）ので、リクエストごとに
 * 変わる値を入れると2ターン目以降も初回の値が貼られ続ける。`agent.invoke` の
 * `InvokeOptions` にも渡す口は無い。
 *
 * そのうえ `traceAttributes` が付くのは親 span（`invoke_agent`）だけで、
 * `chat` やツール実行の span には付かない（SDK の `startModelInvokeSpan` /
 * `startToolCallSpan` はマージしない）。
 *
 * そこで `AsyncLocalStorage` に置き、SpanProcessor が**全ての span** に貼る。
 * Web 検索の予算（`tools/web-search.ts`）と同じ手筋である。
 */
export interface InvocationAttributes {
  /** 会話の帰属先。GenAI Observability のセッション画面がこれで span を束ねる。 */
  sessionId: string;
  /** どのタブの処理か。ドメイン名より細かく、会議ドメインの3タスクを区別できる。 */
  taskId: string;
}

const storage = new AsyncLocalStorage<InvocationAttributes>();

export function withInvocationAttributes<T>(
  attributes: InvocationAttributes,
  run: () => Promise<T>,
): Promise<T> {
  return storage.run(attributes, run);
}

export function currentInvocationAttributes():
  | InvocationAttributes
  | undefined {
  return storage.getStore();
}
