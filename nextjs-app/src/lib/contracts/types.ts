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
  | "meeting.recommend-schedule";

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
  fare: string;
  duration: string;
  transfer_count: number;
  is_selected: boolean;
  reason: string;
  commuter_pass_overlap_sections: string[] | null;
};

export type ParseReservationOutput = {
  borrow_at: string | null;
  return_at: string | null;
  origin: string | null;
  destination: string | null;
  purpose: Purpose | null;
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

/** taskId から出力の型を引く表。`OUTPUT_SCHEMAS` の型検査版（ADR-0004）。 */
export type TaskOutputMap = {
  "ic-card.parse-reservation": ParseReservationOutput;
  "meeting.parse-candidates": ParseCandidatesOutput;
  "meeting.parse-availability": ParseAvailabilityOutput;
  "meeting.recommend-schedule": RecommendScheduleOutput;
};

/**
 * taskId から構造化入力の型を引く表（ADR-0005）。`INPUT_SCHEMAS` の型検査版。
 * 構造化入力を持たない taskId（交通IC）は `undefined`。
 */
export type TaskInputMap = {
  "ic-card.parse-reservation": undefined;
  "meeting.parse-candidates": {
    duration_minutes: DurationMinutes;
    calendar_start: string;
    calendar_end: string;
  };
  "meeting.parse-availability": ParseAvailabilityInput;
  "meeting.recommend-schedule": RecommendScheduleInput;
};
