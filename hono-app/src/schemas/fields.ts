import { z } from 'zod'

/**
 * 会議ロジの値域（`CONTEXT.md`「参加形式」「参加可否」）。
 *
 * 各列挙は**配列を正典にして型を導く**。値を足したときに、表示名の表
 * （`Record<MeetingFormat, string>` など）が型検査で追加を要求する。列挙を2箇所に
 * 書くと、選択肢に出るのに表示名の無い値が作れてしまう。
 */

/**
 * 参加形式の値域と、ラジオに並べる順。
 *
 * 「未定」も参加形式としては挙がるが値域に置かない。未定のときに参加可否の選択肢を
 * 4つ出すのか3つに畳むのかが一意に決まらないため（#66）。
 */
export const MEETING_FORMAT_ORDER = ['hybrid', 'onsite', 'online'] as const

/**
 * 参加可否の値域と、ラジオに並べる順。
 *
 * **未定は「未回答」ではない。** 未定は参加者が答えた結果であり、未回答は回答の不在で、
 * 後者は参加可否表のセルが存在しないことで表す。
 */
export const AVAILABILITY_ORDER = [
  'attend_onsite',
  'attend_remote',
  'absent',
  'undecided',
] as const

/**
 * 所要時間（分）の選択肢。自由入力にせず30分刻みに縛る（#69）。候補日程が終了時刻を
 * 持たない（ADR-0005）ので、この値は**終わる時刻を決める唯一の与件**でもある。
 */
export const DURATION_OPTIONS = [30, 60, 90, 120] as const

/**
 * 候補日程を一意に指す識別子の形。**フロントエンドが発番し、AI は自分では作らない**
 * （ADR-0005）。構造化入力はサニタイズも Guardrail チェックも通らない（ADR-0004）ので、
 * 検査を通さない値に自由文字列を許すと prompt injection の窓になる。
 */
export const CANDIDATE_ID_PATTERN = /^candidate-\d{1,6}$/

/**
 * 1回のリクエストで渡せる候補日程の上限。AI が1回の応答で作れる件数
 * （`MAX_CANDIDATES`）とは別物 — あちらは AI が作れる件数で、こちらは画面が
 * 抱えている件数である。
 */
export const MAX_INPUT_CANDIDATES = 30

/**
 * 入力契約と出力契約が共有する欄の定義。
 *
 * WHY: 候補日程の項目（識別子・日付・開始時刻）は、抽出系の入出力
 * （`meeting.parse-candidates` / `meeting.parse-availability`）と推薦系の入出力
 * （`meeting.recommend-schedule`）の両方に現れる。同じ形を2度書くと、片方だけに
 * 制約が足された瞬間に「同じ候補日程」が2つの意味を持つ。
 */

/**
 * 日付と時刻の本体。`YYYY-MM-DD` / `HH:mm` / `YYYY-MM-DDTHH:mm` の3つが同じ形を
 * 使うので、パターンをここから組む。
 */
const DATE_BODY = '\\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01])'
const TIME_BODY = '([01]\\d|2[0-3]):[0-5]\\d'

const ISO8601_DATE = new RegExp(`^${DATE_BODY}$`)

/**
 * 暦に実在する日付か。`2026-02-31` のように月日の範囲は満たすが存在しない日を弾く。
 * 正規表現だけでは月末の日数と閏年を見られない。
 */
function isCalendarDate(value: string): boolean {
  const parsed = new Date(`${value}T00:00:00Z`)
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().startsWith(`${value}T`)
  )
}

/** 日付欄の共通スキーマ。交通ICの借りる日（#86）と会議ロジの両方がこれを使う。 */
export const isoDateSchema = z
  .string()
  .regex(ISO8601_DATE)
  .refine(isCalendarDate, { error: '暦に存在しない日付です' })

const HH_MM = new RegExp(`^${TIME_BODY}$`)

export const timeOfDaySchema = z.string().regex(HH_MM)

/**
 * ISO8601 の日時（`YYYY-MM-DDTHH:mm`）。**タイムゾーンも秒も持たない。**
 * 交通ICの返す日時が使う（#68）。
 */
const ISO8601_DATE_TIME = new RegExp(`^${DATE_BODY}T${TIME_BODY}$`)

function isCalendarDateTime(value: string): boolean {
  return isCalendarDate(value.split('T')[0])
}

export const isoDateTimeSchema = z
  .string()
  .regex(ISO8601_DATE_TIME)
  .refine(isCalendarDateTime, { error: '暦に存在しない日付です' })

/** 候補日程の識別子。 */
export const candidateIdSchema = z
  .string()
  .regex(CANDIDATE_ID_PATTERN)
  .describe('候補日程の識別子。入力で与えられたものをそのまま使う')

/**
 * 会議の候補日程ひとつ。**終了時刻を持たない**（ADR-0005 / `CONTEXT.md`「候補日程」）。
 * 終わる時刻は会議の所要時間から導く。
 */
export const candidateFieldsSchema = z.object({
  id: candidateIdSchema,
  date: isoDateSchema.describe('候補日程の日付。YYYY-MM-DD 形式'),
  start_time: timeOfDaySchema.describe('開始時刻。HH:mm 形式（24時間表記）'),
})

/** 会議の所要時間（分）。終わる時刻はこの値と開始時刻から導かれる。 */
export const durationMinutesSchema = z
  .literal(DURATION_OPTIONS)
  .describe(
    `会議の所要時間（分）。候補日程の終了時刻はこの値から導く。${DURATION_OPTIONS.join(' / ')} のいずれか`,
  )

/** 参加形式。会議ごとに1つ決まり、参加者に見せる参加可否の選択肢を決める。 */
export const meetingFormatSchema = z
  .enum(MEETING_FORMAT_ORDER)
  .describe(
    '参加形式。hybrid=ハイブリッド / onsite=現地のみ / online=オンラインのみ',
  )

/** 参加可否ひとつ。未回答はこの値では表さず、参加可否表のセルが無いことで表す。 */
export const availabilitySchema = z
  .enum(AVAILABILITY_ORDER)
  .describe(
    '参加可否。attend_onsite=現地で出席 / attend_remote=リモートで出席 / absent=欠席 / undecided=未定',
  )

/**
 * 往復区分の値域（`CONTEXT.md`「往復区分」）。
 *
 * `..._ORDER` と呼ばないのは並び順を使う消費者がいないため（`PURPOSE_VALUES` と同じ）。
 * ラジオの並びは画面側の表示名の表が決める。
 *
 * 与件（`input`）と出力の両方に載る。**1人あたり運賃（見込み）を片道分にするか
 * 往復分にするかを決める**唯一の材料で、これが無かった間は Skill の「往復なら往復分」
 * という指示が効きようがなかった（#168）。
 */
export const ROUND_TRIP_VALUES = ['one_way', 'round'] as const

export type RoundTrip = (typeof ROUND_TRIP_VALUES)[number]

export const roundTripSchema = z
  .enum(ROUND_TRIP_VALUES)
  .describe('往復区分。one_way=片道 / round=往復')
