import type {
  AiErrorCode,
  AiErrorResponse,
  AiTaskSuccessResponse,
  INPUT_SCHEMAS,
  OUTPUT_SCHEMAS,
  TaskId,
  WebSearchCitation,
} from "@contracts/index.js";
import type { z } from "zod";

/**
 * SSG なのでビルド時に埋め込まれる。本番は CloudFront で配信した静的ファイルから
 * ALB 上の BFF を直接叩くため、相対パスではなく絶対 URL で持つ。
 */
const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8787";

/**
 * 応答を待つ上限（設計書 8節「実装時の注意事項」）。
 *
 * WHY 画面が持つか: BFF と Runtime にもそれぞれの上限があるが、それが効かない経路が
 * ある（BFF ごと落ちた・経路の途中で握られた）。待つのをやめる判断は待っている側に
 * しか下せないので、画面が自分の上限を持つ。
 *
 * 打ち切りは TIMEOUT として返す。Runtime は生きていて遅いだけかもしれないので、
 * 案内は非AI経路ではなく再送へ寄る（`error-guidance.ts`）。
 */
export const REQUEST_TIMEOUT_MS = 60_000;

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
  | {
      ok: true;
      sessionId: string;
      result: TaskOutputs[TTaskId];
      /**
       * Runtime が実際に取得した Web 検索の出典（#46）。**AI の出力ではない。**
       *
       * AWS の Web Search Tool の「許容される利用方法」が表示を義務づけている。
       * `result.sources` はモデルの申告なので、遵守をそちらに依存させない。
       */
      citations: WebSearchCitation[];
    }
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
  /**
   * 呼び出し側から打ち切るための signal。省略すると60秒の上限だけが効く。
   *
   * WHY 要るか: 「最初からやり直す」は連番（`submitSerial`）で結果を捨てているが、
   * 捨てるだけでは飛んでいるリクエストは走り続け、Runtime は最後まで推論する。
   * 職員が捨てると決めた往復に課金と時間を使わないよう、実際に止める手を渡す。
   */
  signal?: AbortSignal;
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
 *
 * 待つのは `REQUEST_TIMEOUT_MS` まで。呼び出し側から止めたいときは `signal` を渡す。
 */
export async function requestAiTask<TTaskId extends TaskId>({
  taskId,
  prompt,
  sessionId,
  input,
  signal,
}: AiTaskRequestArgs<TTaskId>): Promise<AiTaskOutcome<TTaskId>> {
  /*
    60秒の上限と呼び出し側の signal を1つの AbortController に束ねる。`AbortSignal.any`
    でも書けるが、こちらは打ち切られたことを `controller.signal.aborted` で見分けられる
    （通信の失敗と区別が付く。上限で切れたのか職員が止めたのかは区別しない — どちらも
    「待つのをやめた」で、職員が止めた分は呼び出し側が連番で捨てる）。
  */
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timer = setTimeout(abort, REQUEST_TIMEOUT_MS);
  signal?.addEventListener("abort", abort);

  /*
    後片付けは**本文を読み終えるまで**掛ける。`fetch` が解決した時点で解除すると、
    ヘッダだけ届いて本文が来ない経路（BFF が握ったまま切らない）で上限が効かず、
    職員の「中断」も届かない。
  */
  try {
    let response: Response;
    try {
      response = await fetch(`${API_BASE_URL}/api/ai/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId, prompt, sessionId, input }),
        signal: controller.signal,
      });
    } catch {
      // 打ち切りも通信の失敗も fetch の reject として同じ形で来るので、どちらだったかは
      // controller を見て決める。打ち切りでなければ BFF ごと落ちている場合で、Runtime
      // 障害と同じ案内で構わない（どちらも職員にできることは手動入力へ移ることだけ）。
      return {
        ok: false,
        code: controller.signal.aborted ? "TIMEOUT" : "RUNTIME_UNAVAILABLE",
      };
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      // 本文の途中で打ち切られた場合と、JSON でない応答が返った場合を分ける。
      // 前者を PARSE_FAILED にすると「書き方を変えて送り直せ」と案内してしまう。
      if (controller.signal.aborted) return { ok: false, code: "TIMEOUT" };
      body = null;
    }

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
    return {
      ok: true,
      sessionId: success.sessionId,
      result: success.result,
      // 欄が無い応答（この欄を持たない版の BFF）は空配列として扱う。出典が
      // 無いことと、検索を使わなかったことは画面では同じ「何も出さない」になる。
      citations: success.citations ?? [],
    };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}
