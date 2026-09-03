import { z } from 'zod';
import {
  candidateFieldsSchema,
  END_AFTER_START_ERROR,
  endsAfterStart,
  isoDateSchema,
} from './fields.js';
import type { TaskId } from './task-ids.js';

/**
 * 全 taskId 共通の必須フィールド（参照ドキュメント 6.2節）。
 *
 * message は情報不足時の聞き返しもここに入る。sources は Websearch を使った
 * ときの参照元だが、この検証環境は Websearch を持たないので常に空配列になる。
 */
const commonOutputFields = {
  message: z
    .string()
    .describe(
      'ユーザーへの説明。抽出できなかった項目がある場合は、何が足りないかを尋ねる質問を含める',
    ),
  sources: z
    .array(z.string())
    .describe('参照元 URL のリスト。Web 検索を使っていない場合は空配列'),
};

export const parseReservationOutputSchema = z.object({
  departure_date: isoDateSchema
    .nullable()
    .describe('出発日。YYYY-MM-DD 形式。読み取れない場合は null'),
  return_date: isoDateSchema
    .nullable()
    .describe('帰着日。YYYY-MM-DD 形式。読み取れない場合は null'),
  origin: z.string().nullable().describe('出発地。読み取れない場合は null'),
  destination: z
    .string()
    .nullable()
    .describe('目的地。読み取れない場合は null'),
  transport: z
    .enum(['train', 'flight', 'other'])
    .nullable()
    .describe('交通手段。読み取れない場合は null'),
  ...commonOutputFields,
});

export type ParseReservationOutput = z.infer<
  typeof parseReservationOutputSchema
>;

const candidateSchema = candidateFieldsSchema.refine(
  endsAfterStart,
  END_AFTER_START_ERROR,
);

/** 1回の応答で返せる候補日程の上限。`SKILL.md` の制約と同じ数を置く。 */
export const MAX_CANDIDATES = 10;

export const parseCandidatesOutputSchema = z.object({
  candidates: z
    .array(candidateSchema)
    .max(MAX_CANDIDATES)
    .describe(
      `会議の候補日程。多くとも${MAX_CANDIDATES}件。読み取れない場合は空配列`,
    ),
  ...commonOutputFields,
});

export type ParseCandidatesOutput = z.infer<typeof parseCandidatesOutputSchema>;

/**
 * 候補日程ひとつに対する参加可否。
 *
 * 候補日程IDではなく日付で写す。ユーザーの自然文が言っているのは日付であって
 * 候補日程IDではなく、IDへの解決は AI にとって余計な仕事になる（ADR-003）。この日付を
 * 画面が持っている候補日程の一覧に当てる突き合わせはフロントエンドが行う。
 */
const availabilitySchema = z.object({
  date: isoDateSchema.describe('参加可否を答えた日付。YYYY-MM-DD 形式'),
  /**
   * ○×の2値に留める。`maybe` や時間帯を足すと、手で埋める側（各候補日程に手動で○×）
   * にもそれを入れる UI が要り、非AI経路と形が揃わなくなる。「16日の午後なら大丈夫」
   * のような入力は `message` が説明して吸収する。
   */
  available: z
    .boolean()
    .describe('その日付に参加できるなら true、できないなら false'),
});

/** 1回の応答で返せる参加可否の上限。`SKILL.md` の制約と同じ数を置く。 */
export const MAX_AVAILABILITY_ENTRIES = 10;

export const parseAvailabilityOutputSchema = z.object({
  availability: z
    .array(availabilitySchema)
    .max(MAX_AVAILABILITY_ENTRIES)
    .describe(
      `日付ごとの参加可否。多くとも${MAX_AVAILABILITY_ENTRIES}件。読み取れない場合は空配列`,
    ),
  ...commonOutputFields,
});

export type ParseAvailabilityOutput = z.infer<
  typeof parseAvailabilityOutputSchema
>;

/**
 * 候補日程ひとつに対する順位と理由。
 *
 * 候補日程は3項目の組で指す。推薦系の入力は自然文ではないので、日付だけをキーに
 * した ADR-003 の根拠（「ユーザーの自然文が言っているのは日付」）が効かない。
 * 日付だけにすると同じ日の別の時間帯を区別できず、どちらを薦めたのか画面が決められない。
 */
const recommendationSchema = candidateFieldsSchema
  .extend({
    rank: z
      .int()
      .min(1)
      .describe('順位。1が最も推奨。全候補日程で重複しない 1..N の値'),
    reason: z
      .string()
      .describe(
        'この候補日程がこの順位になった理由。参加できない参加者や未回答の参加者に触れる',
      ),
  })
  .refine(endsAfterStart, END_AFTER_START_ERROR);

/**
 * 順位が 1..N の順列であること。
 *
 * WHY: モックの参加可否表は最多○が同数の候補日程を2つ作るので、AI は同数をどう
 * 捌くかを説明せざるを得ない。同順位（両方1位）を許すと、その説明を回避できてしまう。
 * 抜け（1,2,4,5）も同じで、順位が全体の中の位置を表さなくなる。
 *
 * 欄をまたぐ不変条件なので JSON Schema には写らない。`start_time < end_time` と同じく
 * `safeParse` の段で弾かれて再試行に回るため、同じ制約を `SKILL.md` にも書く。
 */
function isRankPermutation(
  recommendations: readonly { rank: number }[],
): boolean {
  const ranks = recommendations
    .map((entry) => entry.rank)
    .sort((a, b) => a - b);
  return ranks.every((rank, index) => rank === index + 1);
}

export const recommendScheduleOutputSchema = z.object({
  recommendations: z
    .array(recommendationSchema)
    .min(1)
    .refine(isRankPermutation, {
      error: '順位は 1 から始まる連番で、重複も抜けもあってはいけません',
    })
    .describe('全候補日程の順位と理由。入力の候補日程と同数'),
  ...commonOutputFields,
});

export type RecommendScheduleOutput = z.infer<
  typeof recommendScheduleOutputSchema
>;

/**
 * taskId から出力契約を引くための表。Runtime は Structured Output のスキーマとして、
 * BFF はフロントエンドへ返す前の検査として、同じものを参照する。
 */
export const OUTPUT_SCHEMAS = {
  'ic-card.parse-reservation': parseReservationOutputSchema,
  'meeting.parse-candidates': parseCandidatesOutputSchema,
  'meeting.parse-availability': parseAvailabilityOutputSchema,
  'meeting.recommend-schedule': recommendScheduleOutputSchema,
} satisfies Record<TaskId, z.ZodType>;
