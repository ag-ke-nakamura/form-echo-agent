import { z } from 'zod';
import {
  availabilitySchema,
  candidateIdSchema,
  isoDateSchema,
  timeOfDaySchema,
} from './fields.js';
import { MAX_INPUT_CANDIDATES } from './meeting.js';
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

/**
 * 新しく作られた候補日程ひとつ。**識別子を持たない。**
 *
 * WHY: 識別子はフロントエンドが発番し、AI は自分では作らない（ADR-0005）。このタスクは
 * まだ存在しない候補日程を作るので、AI には選ぶべき既存の識別子が無い。発番させると、
 * 画面が既に配った識別子と衝突する組を作れてしまう。
 *
 * 終了時刻も持たない。終わる時刻は会議の所要時間から導く（`CONTEXT.md`「候補日程」）。
 * 所要時間は構造化入力として渡してあるので、AI は開始時刻だけを決めればよい。
 */
const newCandidateSchema = z.object({
  date: isoDateSchema.describe('候補日程の日付。YYYY-MM-DD 形式'),
  start_time: timeOfDaySchema.describe('開始時刻。HH:mm 形式（24時間表記）'),
});

/** 1回の応答で返せる候補日程の上限。`SKILL.md` の制約と同じ数を置く。 */
export const MAX_CANDIDATES = 10;

export const parseCandidatesOutputSchema = z.object({
  candidates: z
    .array(newCandidateSchema)
    .max(MAX_CANDIDATES)
    .describe(
      `会議の候補日程。多くとも${MAX_CANDIDATES}件。読み取れない場合は空配列`,
    ),
  ...commonOutputFields,
});

export type ParseCandidatesOutput = z.infer<typeof parseCandidatesOutputSchema>;

/**
 * 候補日程ひとつに対する参加可否。**候補日程は識別子で指す**（ADR-0005）。
 *
 * 日付で写していたのは、契約に識別子が無かったからである。クリック単位が候補日程に
 * なった結果（#69）**同じ日に複数の候補日程が普通に発生する**ので、日付で指すと
 * 「10月15日の14時には出られるが16時は無理」を表せない。
 *
 * **判定できなかった候補日程は要素を持たない。`null` を返させない。** 参加可否の
 * 値域に「判定できず」を足すのと同じことになり、参加者が答えた未定と AI が読み取れ
 * なかったことが同じ列挙に並ぶ（`CONTEXT.md`「未定」）。要素の不在で表せば、画面は
 * 「（判定できませんでした）」として聞き返しの対象にできる。
 */
const candidateAvailabilitySchema = z.object({
  candidate_id: candidateIdSchema.describe(
    '参加可否を答えた候補日程の識別子。入力の candidates にあるものだけを使う',
  ),
  availability: availabilitySchema,
  /**
   * 備考（`CONTEXT.md`「備考」）。4つの選択肢に収まらない事情をここへ移す。
   *
   * WHY 参加可否と別の欄にするか: 「午前中は別の予定があります」を参加可否の値で
   * 表そうとすると、値域が事情の数だけ増える。欄を分ければ、参加可否は4状態のまま
   * 保たれ、画面は備考欄へそのまま写せる。
   *
   * WHY `note` か（設計書 6.4節の `comment` ではなく）: 用語集が「コメント」を
   * _Avoid_ にしている。契約の欄名も3プロジェクトが共有する語彙なので、日本語に
   * 戻したときに用語集と食い違う語を選ばない。
   */
  note: z
    .string()
    .nullable()
    .describe(
      '参加可否に収まらない事情（例:「午前中は別の予定があります」）。無ければ null',
    ),
});

/**
 * 1回の応答で返せる参加可否の上限。**入力の候補日程の上限と同じ数にする。**
 *
 * WHY 候補日程の生成（`MAX_CANDIDATES`）と揃えないか: あちらは AI が新しく作る件数で、
 * 「候補日程は数件であって全営業日ではない」という判断から来ている。こちらは**渡された
 * 候補日程に答える**件数なので、渡しうる件数を下回ってはいけない — 下回ると、上限を
 * 超えた分の候補日程に参加者が答えられないのに、契約もモデルもそれを失敗として
 * 扱わない（`SKILL.md` が先頭から切り詰めるよう指示するだけ）。**画面には可否の
 * 付かない候補日程が黙って残る。**
 *
 * 識別子で答えるようになった（#70）ので、この上限は `findAvailabilityMismatch` の
 * 部分集合の検査に含まれるようになった（入力の候補日程も同じ数で頭打ちになり、
 * 重複も弾かれるため）。それでも残すのは、**この数だけが JSON Schema に写る**ため
 * — 入力を見る検査は `safeParse` の段でしか効かず、モデルへの指示にはならない。
 */
export const MAX_AVAILABILITY_ENTRIES = MAX_INPUT_CANDIDATES;

export const parseAvailabilityOutputSchema = z.object({
  availability: z
    .array(candidateAvailabilitySchema)
    .max(MAX_AVAILABILITY_ENTRIES)
    .describe(
      `候補日程ごとの参加可否。多くとも${MAX_AVAILABILITY_ENTRIES}件。判定できなかった候補日程は含めない`,
    ),
  ...commonOutputFields,
});

export type ParseAvailabilityOutput = z.infer<
  typeof parseAvailabilityOutputSchema
>;

/**
 * 候補日程ひとつに対する**評点と根拠**（ADR-0007）。
 *
 * **候補日程は識別子で指す**（ADR-0005）。日付と開始時刻を写させると、同じものを
 * 2通りで指すことになり、片方だけ書き間違えた組が契約を通ってしまう。
 *
 * WHY 順位ではなく評点か: 設計書 7.2節は同じ判断を評点・ラベル・専用フィールド
 * （`recommended_candidate_id` / `backup_candidate_ids`）の3箇所に置いている。3通りの
 * 言い方で同じことを返させると矛盾した組が出て、ラベルの境界値のたびに再試行が走る。
 * AI に返させるのは評点と根拠だけにし、AI評価ラベルと初期選択は `recommendation.ts` が
 * 導く。**順位が 1..N の順列であること**という欄をまたぐ不変条件も、これで不要になった。
 */
const candidateEvaluationSchema = z.object({
  candidate_id: candidateIdSchema.describe(
    '評点を付けた候補日程の識別子。入力の candidates にあるものだけを使う',
  ),
  /**
   * この候補日程の適切さ。0.0〜1.0。
   *
   * 範囲を縛るのは、閾値（`recommendation.ts` の `SCORE_THRESHOLDS`）が範囲の中の
   * 位置として書かれているため。`1.5` や `-1` が通ると、ラベルの導出が破綻するのでは
   * なく**黙って「推奨」に倒れる** — 職員には AI が強く推したように見える。
   */
  score: z
    .number()
    .min(0)
    .max(1)
    .describe('この候補日程の適切さ。0.0（不適）〜1.0（最適）'),
  /**
   * 評点の根拠（`CONTEXT.md`「候補日提案」）。
   *
   * WHY `comment` か: 用語集は「コメント」を _Avoid_ にしているが、それは**備考**
   * （参加者が書く自由記述）と紛れるためで、こちらは AI が書く根拠である。設計書
   * 7.1節の欄名をそのまま採り、日本語では「根拠」と呼ぶ。
   */
  comment: z
    .string()
    .describe(
      'この評点になった根拠。参加できない参加者や未回答の参加者に触れる。全体の中の順位には触れない',
    ),
});

export const recommendScheduleOutputSchema = z.object({
  evaluations: z
    .array(candidateEvaluationSchema)
    .min(1)
    .describe('全候補日程の評点と根拠。入力の候補日程と同数'),
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
