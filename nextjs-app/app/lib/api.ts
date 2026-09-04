import type {
  AiErrorCode,
  AiErrorResponse,
  AiTaskSuccessResponse,
  INPUT_SCHEMAS,
  OUTPUT_SCHEMAS,
  TaskId,
} from "@contracts/index.js";
import type { z } from "zod";

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
export const AVAILABILITY_TASK_ID =
  "meeting.parse-availability" satisfies TaskId;
export const RECOMMEND_TASK_ID = "meeting.recommend-schedule" satisfies TaskId;

/**
 * taskId から出力の型を引く表。AI入力アシスタントはこの表を通してタブに紐づく。
 *
 * 出力契約の `OUTPUT_SCHEMAS` から導く。同じ対応を手で書き写すと、taskId を
 * 足すときの編集箇所が `ALLOWED_TASK_IDS` / `OUTPUT_SCHEMAS` / ここの3つになり、
 * 「3者が同一の契約を見る」（ADR-002）が画面側だけで崩れる。
 * `import type` なので zod のスキーマ本体はバンドルに乗らない。
 */
export type TaskOutputs = {
  [K in TaskId]: z.infer<(typeof OUTPUT_SCHEMAS)[K]>;
};

/**
 * taskId から構造化入力の型を引く表（ADR-0005）。`TaskOutputs` と対称に置く。
 *
 * 契約の `INPUT_SCHEMAS` から導く。画面側で「このタブはこれを送る」と書き写すと、
 * 契約が入力の形を変えたときにフロントエンドだけが古い形を送り続け、失敗するのは
 * BFF の門（INVALID_INPUT）になる — 画面のコードは型検査を通ったままなので、
 * どこが古いのかが分からない。
 *
 * 構造化入力を持たない taskId（交通IC）は `undefined` になり、**送らないことが
 * 型で決まる。** `import type` なので zod のスキーマ本体はバンドルに乗らない。
 */
export type TaskInputs = {
  [K in TaskId]: (typeof INPUT_SCHEMAS)[K] extends infer TSchema
    ? TSchema extends z.ZodType
      ? z.infer<TSchema>
      : undefined
    : never;
};

export type AiTaskOutcome<TTaskId extends TaskId> =
  | { ok: true; sessionId: string; result: TaskOutputs[TTaskId] }
  | { ok: false; code: AiErrorCode };

export type AiTaskRequestArgs<TTaskId extends TaskId> = {
  taskId: TTaskId;
  /** 職員が書いた自然文。推薦系では省略できる（ADR-0004）。 */
  prompt: string | null;
  sessionId: string | null;
  /**
   * 構造化入力（ADR-0005）。持たない taskId では `undefined` を渡す。
   *
   * **追加の指示のときも毎回そのまま送る。** Runtime 側の会話履歴は
   * コールドスタートで消えるので、初回だけ送ると2回目が「与件の無いリクエスト」に
   * なる（ADR-0004）。
   */
  input: TaskInputs[TTaskId];
};

/**
 * BFF の `POST /api/ai/tasks` を叩く。
 *
 * taskId 以外は全タブで同じなので、経路もひとつに保つ。タブを増やしても
 * 変わるのは出力契約の許可リストだけで、この関数もその戻り値の型も動かない。
 *
 * `sessionId` は初回 null、2回目以降は前回の応答が返したものを渡す。これが
 * 追加の指示を同じ会話の続きとして届ける唯一の手立てになる — `input` が運ぶのは
 * 画面の**今の**状態だけで、前に何を指示したかは Runtime 側の会話履歴にしかない。
 */
export async function requestAiTask<TTaskId extends TaskId>({
  taskId,
  prompt,
  sessionId,
  input,
}: AiTaskRequestArgs<TTaskId>): Promise<AiTaskOutcome<TTaskId>> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/api/ai/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId, prompt, sessionId, input }),
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
  // sessionId まで見る。無いまま成功にすると次の指示が sessionId 未指定で飛び、
  // BFF が新しいセッションを発行する。呼び出しは通るので画面はエラーを出さず、
  // 追加の指示が**黙って初回として扱われる**（会話が続いていないことに気づけない）。
  if (!success?.result || typeof success.sessionId !== "string") {
    return { ok: false, code: "PARSE_FAILED" };
  }
  return { ok: true, sessionId: success.sessionId, result: success.result };
}
