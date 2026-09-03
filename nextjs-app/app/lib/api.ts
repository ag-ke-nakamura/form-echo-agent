import type {
  AiErrorCode,
  AiErrorResponse,
  AiTaskSuccessResponse,
  ParseCandidatesOutput,
  ParseReservationOutput,
  TaskId,
} from "@contracts/index.js";

/**
 * SSG なのでビルド時に埋め込まれる。本番は CloudFront で配信した静的ファイルから
 * ALB 上の BFF を直接叩くため、相対パスではなく絶対 URL で持つ。
 */
const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8787";

/**
 * 出力契約の taskId 許可リストに対して型で照合される。
 *
 * 注釈ではなく `satisfies` を使う。`: TaskId` と書くとリテラル型が許可リスト全体の
 * union に広がり、`requestAiTask` の戻り値もタブ全部の出力の union になってしまう。
 */
export const RESERVATION_TASK_ID = "ic-card.parse-reservation" satisfies TaskId;
export const CANDIDATES_TASK_ID = "meeting.parse-candidates" satisfies TaskId;

/** taskId から出力の型を引く表。AI チャット欄はこの表を通してタブに紐づく。 */
export interface TaskOutputs {
  "ic-card.parse-reservation": ParseReservationOutput;
  "meeting.parse-candidates": ParseCandidatesOutput;
}

export type AiTaskOutcome<TTaskId extends TaskId> =
  | { ok: true; result: TaskOutputs[TTaskId] }
  | { ok: false; code: AiErrorCode };

/**
 * BFF の `POST /api/ai/tasks` を叩く。
 *
 * taskId 以外は全タブで同じなので、経路もひとつに保つ。タブを増やしても
 * 増えるのは `TaskOutputs` の1行だけで、この関数は変わらない。
 */
export async function requestAiTask<TTaskId extends TaskId>(
  taskId: TTaskId,
  prompt: string,
): Promise<AiTaskOutcome<TTaskId>> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/api/ai/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId, prompt, sessionId: null }),
    });
  } catch {
    // BFF ごと落ちている場合。Runtime 障害と同じ案内で構わない（どちらも
    // 職員にできることは手動入力へ移ることだけ）。
    return { ok: false, code: "RUNTIME_UNAVAILABLE" };
  }

  const body: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const code = (body as AiErrorResponse | null)?.error?.code;
    return { ok: false, code: code ?? "INTERNAL_ERROR" };
  }

  const success = body as AiTaskSuccessResponse<TaskOutputs[TTaskId]> | null;
  if (!success?.result) {
    return { ok: false, code: "PARSE_FAILED" };
  }
  return { ok: true, result: success.result };
}
