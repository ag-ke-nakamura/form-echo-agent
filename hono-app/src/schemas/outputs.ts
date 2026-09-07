import { z } from 'zod'
import {
  availabilitySchema,
  candidateIdSchema,
  isoDateSchema,
  isoDateTimeSchema,
  MAX_INPUT_CANDIDATES,
  timeOfDaySchema,
} from './fields.js'
import type { TaskId } from './task-ids.js'

/**
 * 全 taskId 共通の必須フィールド（参照ドキュメント 6.2節）。
 *
 * message は情報不足時の聞き返しもここに入る。sources は Websearch を使ったときの
 * 参照元。**Websearch を持つのは交通ICだけ**（#46、`docs/reference-doc-fixes.md` F-22）
 * なので、会議ロジの3タスクでは常に空配列になる。
 */
const commonOutputFields = {
  message: z
    .string()
    .describe(
      'ユーザーへの説明。抽出できなかった項目がある場合は、何が足りないかを尋ねる質問を含める',
    ),
  sources: z
    .array(z.string())
    .describe(
      '回答の根拠にした参照元 URL のリスト。Web 検索を使っていない場合は空配列',
    ),
}

/**
 * ICカードの利用目的（#68）。**自由文字列にしない。**
 *
 * 自由文字列だと「打合せ」「打ち合わせ」「ミーティング」が同じ目的の別表記として並び、
 * 画面の `<select>` がどれにも一致しない（結果として未選択に見える）。
 */
const PURPOSE_VALUES = [
  'discussion',
  'training',
  'inspection',
  'business_trip',
  'other',
] as const

/** 1回の応答で返せる経路候補の上限（#100）。`SKILL.md` の制約と同じ数を置く。 */
export const MAX_ROUTE_CANDIDATES = 5

/**
 * 移動経路の候補ひとつ（#100、`CONTEXT.md`「移動経路」）。
 *
 * `is_selected` はちょうど1件（経路候補が0件のときは0件）という不変条件を
 * `parseReservationOutputSchema` の `.refine()` が見る。
 */
const routeCandidateSchema = z.object({
  route: z
    .string()
    .describe(
      '出発地から目的地までの移動経路。区間ごとに利用交通機関を添えた1本の文字列（例:「新宿(東京メトロ丸ノ内線) => 霞ケ関(東京メトロ日比谷線) => 虎ノ門ヒルズ」）',
    ),
  /** IC運賃前提の運賃（#100）。グリーン車・特急料金は含まない。 */
  fare: z.string().describe('IC運賃（例:「1980円」）。往復なら往復分の合計'),
  duration: z.string().describe('所要時間（例:「2時間30分」）'),
  transfer_count: z.number().int().min(0).describe('乗換回数。乗り換えなしは0'),
  is_selected: z
    .boolean()
    .describe('比較検討した結果、この経路候補を採用したかどうか'),
  reason: z
    .string()
    .describe(
      '採用した理由、または他の候補と比べて採用しなかった理由（例:「運賃が最安」「所要時間が最短の1.5倍を超える」）',
    ),
  /**
   * 定期重複区間（#101、CONTEXT.md「定期重複区間」）。
   *
   * **自由文に定期区間の言及が無ければ全候補で null のまま。** 言及があるのに重複が
   * 無い候補は空配列にする — null は「定期区間そのものが不明」、空配列は
   * 「定期区間は分かったがこの候補とは重ならない」を表す。
   */
  commuter_pass_overlap_sections: z
    .array(z.string())
    .nullable()
    .describe(
      '定期区間とこの経路候補が重複する駅間。連続区間ごとに「駅名 => 駅名」の形式で1件（例:「新宿 => 渋谷」）。自由文に定期区間の言及が無い場合は null',
    ),
})

export const parseReservationOutputSchema = z
  .object({
    /*
      借りる日はカードを受け取る**日**であって時点ではない（#86）。返す日時は
      引き続き時点なので `isoDateTimeSchema` のまま。
    */
    borrow_at: isoDateSchema
      .nullable()
      .describe('ICカードを借りる日。YYYY-MM-DD 形式。読み取れない場合は null'),
    return_at: isoDateTimeSchema
      .nullable()
      .describe(
        'ICカードを返す日時。YYYY-MM-DDTHH:mm 形式。読み取れない場合は null',
      ),
    origin: z.string().nullable().describe('出発地。読み取れない場合は null'),
    destination: z
      .string()
      .nullable()
      .describe('目的地。読み取れない場合は null'),
    purpose: z
      .enum(PURPOSE_VALUES)
      .nullable()
      .describe(
        '利用目的。discussion=打ち合わせ / training=研修 / inspection=視察 / business_trip=出張 / other=その他。読み取れない場合は null',
      ),
    route_candidates: z
      .array(routeCandidateSchema)
      .max(MAX_ROUTE_CANDIDATES)
      .describe(
        `出発地から目的地までの経路候補。比較検討した上での最安経路を \`is_selected\` で示す。多くとも${MAX_ROUTE_CANDIDATES}件。Web検索で裏取りできない場合は空配列`,
      ),
    ...commonOutputFields,
  })
  .refine(
    (output) => {
      const selected = output.route_candidates.filter(
        (candidate) => candidate.is_selected,
      ).length
      return selected === (output.route_candidates.length === 0 ? 0 : 1)
    },
    {
      error:
        '採用フラグ（is_selected）は、経路候補があるときはちょうど1件、無いときは0件にする必要があります',
      path: ['route_candidates'],
    },
  )

export type ParseReservationOutput = z.infer<
  typeof parseReservationOutputSchema
>

/**
 * 新しく作られた候補日程ひとつ。**識別子を持たない。**
 *
 * 識別子はフロントエンドが発番し、AI は自分では作らない（ADR-0005）。このタスクは
 * まだ存在しない候補日程を作るので、AI には選ぶべき既存の識別子が無い。
 *
 * 終了時刻も持たない。終わる時刻は会議の所要時間から導く（`CONTEXT.md`「候補日程」）。
 */
const newCandidateSchema = z.object({
  date: isoDateSchema.describe('候補日程の日付。YYYY-MM-DD 形式'),
  start_time: timeOfDaySchema.describe('開始時刻。HH:mm 形式（24時間表記）'),
})

/** 1回の応答で返せる候補日程の上限。`SKILL.md` の制約と同じ数を置く。 */
export const MAX_CANDIDATES = 10

export const parseCandidatesOutputSchema = z.object({
  candidates: z
    .array(newCandidateSchema)
    .max(MAX_CANDIDATES)
    .describe(
      `会議の候補日程。多くとも${MAX_CANDIDATES}件。読み取れない場合は空配列`,
    ),
  ...commonOutputFields,
})

export type ParseCandidatesOutput = z.infer<typeof parseCandidatesOutputSchema>

/**
 * 候補日程ひとつに対する参加可否。**候補日程は識別子で指す**（ADR-0005）。
 *
 * **判定できなかった候補日程は要素を持たない。`null` を返させない。** 要素の不在で
 * 表せば、画面は「（判定できませんでした）」として聞き返しの対象にできる。
 */
const candidateAvailabilitySchema = z.object({
  candidate_id: candidateIdSchema.describe(
    '参加可否を答えた候補日程の識別子。入力の candidates にあるものだけを使う',
  ),
  availability: availabilitySchema,
  /**
   * 備考（`CONTEXT.md`「備考」）。4つの選択肢に収まらない事情をここへ移す。
   *
   * 用語集が「コメント」を _Avoid_ にしているため `note` を使う。
   */
  note: z
    .string()
    .nullable()
    .describe(
      '参加可否に収まらない事情（例:「午前中は別の予定があります」）。無ければ null',
    ),
})

/**
 * 1回の応答で返せる参加可否の上限。**入力の候補日程の上限と同じ数にする。**
 *
 * こちらは**渡された候補日程に答える**件数なので、渡しうる件数を下回ってはいけない
 * — 下回ると、上限を超えた分の候補日程に画面が可否の付かない候補日程を黙って残す。
 */
export const MAX_AVAILABILITY_ENTRIES = MAX_INPUT_CANDIDATES

export const parseAvailabilityOutputSchema = z.object({
  availability: z
    .array(candidateAvailabilitySchema)
    .max(MAX_AVAILABILITY_ENTRIES)
    .describe(
      `候補日程ごとの参加可否。多くとも${MAX_AVAILABILITY_ENTRIES}件。判定できなかった候補日程は含めない`,
    ),
  ...commonOutputFields,
})

export type ParseAvailabilityOutput = z.infer<
  typeof parseAvailabilityOutputSchema
>

/**
 * 候補日程ひとつに対する**評点と根拠**（ADR-0007）。
 *
 * **候補日程は識別子で指す**（ADR-0005）。AI に返させるのは評点と根拠だけにし、
 * AI評価ラベルと初期選択は nextjs-app 側の導出ロジックが決める。
 */
const candidateEvaluationSchema = z.object({
  candidate_id: candidateIdSchema.describe(
    '評点を付けた候補日程の識別子。入力の candidates にあるものだけを使う',
  ),
  /**
   * この候補日程の適切さ。0.0〜1.0。
   *
   * 範囲を縛るのは、閾値が範囲の中の位置として書かれているため。範囲外の値が通ると、
   * ラベルの導出が破綻するのではなく黙って「推奨」に倒れる。
   */
  score: z
    .number()
    .min(0)
    .max(1)
    .describe('この候補日程の適切さ。0.0（不適）〜1.0（最適）'),
  /** 評点の根拠（`CONTEXT.md`「候補日提案」）。 */
  comment: z
    .string()
    .describe(
      'この評点になった根拠。参加できない参加者や未回答の参加者に触れる。全体の中の順位には触れない',
    ),
})

export const recommendScheduleOutputSchema = z.object({
  evaluations: z
    .array(candidateEvaluationSchema)
    .min(1)
    .describe('全候補日程の評点と根拠。入力の候補日程と同数'),
  ...commonOutputFields,
})

export type RecommendScheduleOutput = z.infer<
  typeof recommendScheduleOutputSchema
>

/**
 * taskId から出力契約を引くための表。Runtime は Structured Output のスキーマとして、
 * BFF はフロントエンドへ返す前の検査として、同じものを参照する。
 */
export const OUTPUT_SCHEMAS = {
  'ic-card.parse-reservation': parseReservationOutputSchema,
  'meeting.parse-candidates': parseCandidatesOutputSchema,
  'meeting.parse-availability': parseAvailabilityOutputSchema,
  'meeting.recommend-schedule': recommendScheduleOutputSchema,
} satisfies Record<TaskId, z.ZodType>
