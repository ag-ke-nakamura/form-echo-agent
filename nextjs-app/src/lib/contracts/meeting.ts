/**
 * 会議ロジの値域そのもの。#109（ADR-0011）で `contracts/meeting.ts` から複製した、
 * nextjs-app 自己完結の値域定義。
 *
 * WHY zod を import しないか: フロントエンドは参加形式のラジオを描き、参加可否の
 * セルを描き、所要時間の選択肢を並べるためにこれらを**値として**実行時に必要とする。
 * スキーマと同じモジュールに置くと SSG のバンドルに zod が丸ごと乗る。
 *
 * 各列挙は**配列を正典にして型を導く**。値を足したときに、表示名の表
 * （`Record<MeetingFormat, string>` など）が型検査で追加を要求する。列挙を2箇所に
 * 書くと、選択肢に出るのに表示名の無い値が作れてしまう。
 */

/** 参加形式の値域と、ラジオに並べる順（`CONTEXT.md`「参加形式」）。 */
export const MEETING_FORMAT_ORDER = ["hybrid", "onsite", "online"] as const;

export type MeetingFormat = (typeof MEETING_FORMAT_ORDER)[number];

/**
 * 参加可否の値域と、ラジオに並べる順（`CONTEXT.md`「参加可否」）。
 *
 * **未定は「未回答」ではない。** 未定は参加者が答えた結果であり、未回答は回答の不在で、
 * 後者は参加可否表のセルが存在しないことで表す。
 */
export const AVAILABILITY_ORDER = [
  "attend_onsite",
  "attend_remote",
  "absent",
  "undecided",
] as const;

export type Availability = (typeof AVAILABILITY_ORDER)[number];

/** その参加可否が「参加できる」に数えられるか。 */
export function isAttending(availability: Availability): boolean {
  return availability === "attend_onsite" || availability === "attend_remote";
}

/** 所要時間（分）の選択肢。自由入力にせず30分刻みに縛る。 */
export const DURATION_OPTIONS = [30, 60, 90, 120] as const;

export type DurationMinutes = (typeof DURATION_OPTIONS)[number];

/**
 * 候補日程を一意に指す識別子の形。**フロントエンドが発番し、AI は自分では作らない**
 * （ADR-0005）。
 */
export const CANDIDATE_ID_PATTERN = /^candidate-\d{1,6}$/;

/** 連番から候補日程の識別子を作る。発番するのは画面だけで、AI は選ぶだけ。 */
export function candidateIdOf(sequence: number): string {
  return `candidate-${sequence}`;
}

/**
 * 1回のリクエストで渡せる候補日程の上限。**AI が1回の応答で作れる件数とは別物。**
 *
 * **画面はこの上限を超える前に手を打つ責任を負う**（`features/meeting/shared/candidate-limit.ts`）。
 * 超えたリクエストは BFF の門が INVALID_INPUT で弾くが、職員から見ると自分の書いた
 * 自然文が悪かったように読める。だから値として引ける場所に置いてある。
 */
export const MAX_INPUT_CANDIDATES = 30;
