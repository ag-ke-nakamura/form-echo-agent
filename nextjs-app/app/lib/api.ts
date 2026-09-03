import type {
  AiErrorCode,
  AiErrorResponse,
  AiTaskSuccessResponse,
  ParseReservationOutput,
  TaskId,
} from "@contracts/index.js";

/**
 * SSG なのでビルド時に埋め込まれる。本番は CloudFront で配信した静的ファイルから
 * ALB 上の BFF を直接叩くため、相対パスではなく絶対 URL で持つ。
 */
const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8787";

/** 出力契約の taskId 許可リストに対して型で照合される。 */
export const RESERVATION_TASK_ID: TaskId = "ic-card.parse-reservation";

export type ParseReservationOutcome =
  | { ok: true; result: ParseReservationOutput }
  | { ok: false; code: AiErrorCode };

export async function parseReservation(
  prompt: string,
): Promise<ParseReservationOutcome> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/api/ai/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        taskId: RESERVATION_TASK_ID,
        prompt,
        sessionId: null,
      }),
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

  const success = body as AiTaskSuccessResponse<ParseReservationOutput> | null;
  if (!success?.result) {
    return { ok: false, code: "PARSE_FAILED" };
  }
  return { ok: true, result: success.result };
}
