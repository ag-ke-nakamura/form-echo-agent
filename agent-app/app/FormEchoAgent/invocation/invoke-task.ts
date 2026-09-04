import {
  outputSchemaFor,
  type TaskId,
  type Usage,
} from '../contracts/index.js';
import { getOrCreateDomainAgent } from './domain-agent.js';
import type { InvocationLogger } from './logger.js';
import { invokeWithSchemaRetry } from './structured-output.js';
import { buildUserMessage } from './user-message.js';

// 失敗の型もシーム越しに見せる。ハンドラが境界の内側を直接掴まないため。
export { StructuredOutputError } from './structured-output.js';

/** invocation 境界への入力。BFF が送るリクエストのうち Runtime が処理に使う分。 */
export interface TaskInvocation {
  taskId: TaskId;
  /** 職員が書いた自然文。推薦系では省略できる（ADR-0004）。 */
  prompt?: string | null;
  /**
   * 構造化入力。`INPUT_SCHEMAS` で検査済みのものを受け取る。
   *
   * **追加の指示のときも毎回届く。** Agent キャッシュはベストエフォートで、
   * コールドスタートで会話履歴ごと消える（`domain-agent.ts`）。初回だけ送る形に
   * すると、履歴が消えた後の2回目が「表の無いリクエスト」になり、AI は評点を
   * 付ける対象を持たないまま実行させられる。
   */
  input?: unknown;
  /**
   * AgentCore のセッション ID。会話履歴の帰属先を決める。
   *
   * リクエスト本文の `sessionId` ではなく、AgentCore が確定させた
   * `RequestContext.sessionId` を渡す（初回は本文側が null になるため）。
   */
  sessionId: string;
}

/** invocation 境界からの出力。ハンドラが `sessionId` を添えて応答本文にする。 */
export interface TaskInvocationResult {
  result: unknown;
  usage: Usage;
}

/**
 * Runtime の invocation 境界。
 *
 * 検査済みの `{taskId, prompt, input, sessionId}` から出力契約に適合した構造化
 * データを作る。ドメインエージェントの選択、Agent キャッシュ、Skill の読み込み、
 * Structured Output の再試行はすべてこの関数から辿れる位置にある。
 *
 * WHY: エントリポイントから切り離してあるのは、ドメインとエラー経路が増えるほど
 * `main.ts` が肥大するため。Guardrail チェックの2経路、Skill 選択の2モード、
 * 出力側の再検査もこの内側に足す。テストと実測はこの境界を利用する側であり、
 * 差し替えるのは設定（モデル・Guardrail の実装）だけにする。
 *
 * 失敗は例外で表す。出力契約のエラーコードへの写像はハンドラが持つ。
 */
export async function invokeTask(
  { taskId, prompt, input, sessionId }: TaskInvocation,
  log: InvocationLogger,
): Promise<TaskInvocationResult> {
  const agent = getOrCreateDomainAgent(sessionId, taskId);
  // 履歴の巻き戻しは invokeWithSchemaRetry が試行ごとに行うので、ここでは持たない。
  return invokeWithSchemaRetry(
    agent,
    buildUserMessage(taskId, prompt, input),
    // 入力を見ないと言えない不変条件（提案が入力の候補日程と過不足なく対応して
    // いるか）もここに載せる。値域を外れた評点と同じく作り直しに回す。
    outputSchemaFor(taskId, input),
    log,
  );
}
