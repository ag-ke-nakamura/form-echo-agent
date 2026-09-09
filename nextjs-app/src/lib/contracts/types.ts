import type { Availability, DurationMinutes, MeetingFormat } from "./meeting";

/**
 * 画面が送る `input` の組み立てと、AI の出力を読むのに要る型。#109（ADR-0011）で
 * `contracts/` の出力・入力スキーマ（`inputs.ts` / `outputs.ts` / `task-ids.ts`）から、
 * nextjs-app が実際に使う形だけを複製した。
 *
 * **応答封筒（`sessionId` / `usage` / `citations` / エラーの `code`・`message`）はここに
 * 無い。** #136（ADR-0015）で BFF の `AppType` から型で引くようにしたので、複製は
 * `@/lib/api.ts` 側の導出型に置き換わった。ドリフトするのは出力契約だけである。
 *
 * WHY zod のスキーマではなく素の型か: nextjs-app はこれらの形をリクエストの組み立てと
 * 応答の型付けにしか使わず、自分で受け取った JSON を検証しない（検証するのは BFF と
 * Runtime）。実行時の検査が要らないところに zod を持ち込むと、SSG のバンドルに zod が
 * 余計に乗る。
 */

/** BFF が受け付ける taskId の許可リスト。 */
export type TaskId =
  | "ic-card.parse-reservation"
  | "meeting.parse-candidates"
  | "meeting.parse-availability"
  | "meeting.recommend-schedule"
  | "playground.free-prompt";

/**
 * フォームを持つ4タブの taskId。
 *
 * AI入力アシスタント（指示 → プレビュー → 反映）はこの4つのためのもので、`message` を
 * 持つ出力契約と反映先のフォームがあることを前提にしている。**プロンプト検証タブは
 * どちらも持たない**（ADR-0020）ので、この型で締め出す。
 */
export type FormTaskId = Exclude<TaskId, "playground.free-prompt">;

/** 往復区分（#168。`CONTEXT.md`「往復区分」）。 */
export type RoundTrip = "one_way" | "round";

/**
 * 職員が手で入れたかどうかを添えた与件（ADR-0018）。
 *
 * 値だけを渡すと、AI が手入力の欄を直しても画面が守って反映しないので、フォームの値と
 * 運賃の計算根拠が食い違う。手入力かどうかを知っているのは画面だけなので画面が渡す。
 */
type ManualAware<T> = { value: T; is_manual: boolean };

/**
 * `ic-card.parse-reservation` の入力（出発地・目的地・往復区分。ADR-0017）。
 *
 * 出発地・目的地は空文字列が未入力を表す（#170）。欄が空のまま生成を押す回があり、
 * 画面の `FormState` はどの欄も文字列で持つので、渡す手前で形を変えない。
 */
export type ParseReservationInput = {
  origin: ManualAware<string>;
  destination: ManualAware<string>;
  round_trip: ManualAware<RoundTrip>;
};

/** 交通ICの利用目的（#68）。 */
type Purpose =
  | "discussion"
  | "training"
  | "inspection"
  | "business_trip"
  | "other";

/** 移動経路の候補ひとつ（#100）。 */
export type RouteCandidate = {
  route: string;
  /**
   * IC運賃の額（#169）。**単位を含まない0以上の整数の円**である。
   *
   * 文字列だと「約2000円」「1980円（往復）」が通り、往復区分が往復なのに片道の額が
   * 入っていることを職員が目で確かめられない。単位は表示側が足す（`FARE_UNIT`）。
   */
  fare: number;
  duration: string;
  transfer_count: number;
  is_selected: boolean;
  reason: string;
  /**
   * この候補を引いた経路検索結果の出典番号（#174、ADR-0019）。**必須で、1始まり。**
   *
   * 指しているのは**応答封筒の `citations`** の並び。**画面が引く**（サーバー側は
   * 範囲を検査しない）ので、範囲外の番号は「確認できませんでした」として出す。
   */
  citation_number: number;
  commuter_pass_overlap_sections: string[] | null;
};

export type ParseReservationOutput = {
  borrow_at: string | null;
  return_at: string | null;
  /**
   * 出発日時（#175。CONTEXT.md「出発日時」）。移動を始める日時で、借りる日・
   * 返す日時とは別の概念（あの2つはカードの貸借の話）。**運賃・経路の計算には
   * 使わない**ので与件には載らず、画面が申請に載せる情報として持つだけである。
   */
  depart_at: string | null;
  origin: string | null;
  destination: string | null;
  /**
   * 最寄（#172。CONTEXT.md「最寄」）。運賃計算の起点・終点として解決した駅または
   * バス停で、**入力が既に駅名でも返る。** 特定できなければ null（画面は「不明」）で、
   * そのとき経路候補は空になる。
   */
  origin_nearest: string | null;
  destination_nearest: string | null;
  round_trip: RoundTrip | null;
  purpose: Purpose | null;
  /** 同行者の人数（#176）。**職員自身を含まない。** null は読み取れなかった回。 */
  companion_count: number | null;
  route_candidates: RouteCandidate[];
  message: string;
  sources: string[];
};

export type ParseCandidatesOutput = {
  candidates: { date: string; start_time: string }[];
  message: string;
  sources: string[];
};

/** 会議の候補日程ひとつ（`meeting.parse-candidates` / `meeting.parse-availability` が共有）。 */
export type CandidateFields = {
  id: string;
  date: string;
  start_time: string;
};

export type ParseAvailabilityInput = {
  meeting_format: MeetingFormat;
  duration_minutes: DurationMinutes;
  candidates: CandidateFields[];
};

export type ParseAvailabilityOutput = {
  availability: {
    candidate_id: string;
    availability: Availability;
    note: string | null;
  }[];
  message: string;
  sources: string[];
};

export type RecommendScheduleInput = {
  meeting_format: MeetingFormat;
  duration_minutes: DurationMinutes;
  participants: string[];
  candidates: (CandidateFields & {
    answers: { participant: string; availability: Availability }[];
  })[];
};

export type RecommendScheduleOutput = {
  evaluations: { candidate_id: string; score: number; comment: string }[];
  message: string;
  sources: string[];
};

/**
 * `playground.free-prompt` の入力（ADR-0020）。**持ち込みシステムプロンプト1つだけ。**
 *
 * この欄がそのまま Runtime の system prompt になる。**リクエストの `prompt` 欄が運ぶのは
 * 検証メッセージのほう**（user message としてモデルへ渡る文）で、そちらは空でもよい。
 * 用語が逆に読めるので `CONTEXT.md` の両方の項がこれを明記している。
 */
export type FreePromptInput = { system_prompt: string };

/**
 * `playground.free-prompt` の出力（ADR-0020）。**回答本文1欄だけ。**
 *
 * この検証環境で Structured Output を通らない唯一の出力なので、`message` も
 * `sources` も持たない。**画面はこれを HTML として解釈せずに描く**（改行は保つ）—
 * サニタイズのタグ除去をこの taskId で掛けないことの前提条件である。
 */
export type FreePromptOutput = { text: string };

/** taskId から出力の型を引く表。`OUTPUT_SCHEMAS` の型検査版（ADR-0004）。 */
export type TaskOutputMap = {
  "ic-card.parse-reservation": ParseReservationOutput;
  "meeting.parse-candidates": ParseCandidatesOutput;
  "meeting.parse-availability": ParseAvailabilityOutput;
  "meeting.recommend-schedule": RecommendScheduleOutput;
  "playground.free-prompt": FreePromptOutput;
};

/**
 * taskId から構造化入力の型を引く表（ADR-0005）。`INPUT_SCHEMAS` の型検査版。
 * **`undefined`（構造化入力を持たない）はいま1つも無い** — 交通ICもフォーム主導に
 * なった（ADR-0017）。型は `undefined` を許したまま残す。
 */
export type TaskInputMap = {
  "ic-card.parse-reservation": ParseReservationInput;
  "meeting.parse-candidates": {
    duration_minutes: DurationMinutes;
    calendar_start: string;
    calendar_end: string;
  };
  "meeting.parse-availability": ParseAvailabilityInput;
  "meeting.recommend-schedule": RecommendScheduleInput;
  "playground.free-prompt": FreePromptInput;
};
