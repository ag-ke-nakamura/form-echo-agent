import { z } from 'zod'
import { MAX_PROMPT_LENGTH } from './api.js'
import {
  availabilitySchema,
  candidateFieldsSchema,
  durationMinutesSchema,
  isoDateSchema,
  MAX_INPUT_CANDIDATES,
  meetingFormatSchema,
  roundTripSchema,
} from './fields.js'
import type { TaskId } from './task-ids.js'

/**
 * 参加者ひとりを指す識別子。
 *
 * WHY: 構造化入力は Guardrail チェックとサニタイズの対象にしない（ADR-0004）。
 * 検査を通さない値に自由文字列を許すと、そこが prompt injection の窓になる。
 * 実名を送らないのは ADR-0008。
 */
const PARTICIPANT = /^参加者[A-Z]$/

const participantSchema = z
  .string()
  .regex(PARTICIPANT)
  .describe('参加者の識別子。「参加者A」のような形')

/**
 * 職員が手で入れたかどうかを添えた与件（ADR-0018）。
 *
 * WHY 値だけで渡さないか: 与件は出力にも載る（追加指示で別の値が明示されたら AI が
 * 直せる必要がある）が、**画面は手入力の欄を上書きしない**ので、値だけを渡すと
 * 「フォームの値と運賃の計算根拠が違う」自己矛盾したフォームができる。手入力かどうかを
 * 知っているのは画面だけなので、画面が渡す。食い違ったときの規則は Skill が持つ。
 */
function manualAware<T extends z.ZodType>(value: T) {
  return z.object({
    value,
    is_manual: z
      .boolean()
      .describe(
        '職員が手で入れた値なら true。既定値のまま、または前回 AI が入れた値なら false',
      ),
  })
}

/**
 * 出発地・目的地の長さの上限（#170）。
 *
 * WHY 縛るか: この2欄は形で縛れない（駅名・建物名・組織名を許す）ので、`input` に
 * 自由文字列を置かないという ADR-0004 の縛りが使えない。代わりに Runtime の Guardrail
 * チェックへ通す（ADR-0017）が、それは内容の検査であって長さは見ない。上限が無いと
 * 1つの欄で Guardrail の往復とモデルの文脈をいくらでも太らせられる（`MAX_PROMPT_LENGTH`
 * が `prompt` に掛かっているのと同じ理由）。Runtime も自分の複製で同じ上限を持つ
 * （ADR-0011）が、**画面から来た値を Runtime へ渡す前に見るのは BFF だけである。**
 *
 * **1,000字は参照ドキュメントに出どころを持たない、我々が決めた値である**（`prompt` の
 * 10,000字は 10.1節が出どころ）。
 */
export const MAX_PLACE_LENGTH = 1_000

/**
 * 出発地または目的地（#170）。**職員がフォームに打った自由文字列。**
 *
 * **空文字列は未入力**を表す。フォームの欄が空のまま生成を押す回があるので、
 * 「打っていない」をそのまま渡せる必要がある。
 */
const placeSchema = z.string().max(MAX_PLACE_LENGTH)

/**
 * `ic-card.parse-reservation` の入力（出発地・目的地・往復区分。#168・#170）。
 *
 * **運賃の額を決める与件だけを載せる**（ADR-0017）。往復区分が無かった間、Skill の
 * 「往復なら往復分」は AI が往復かどうかを知る手段が無く死んでいた。出発地・目的地が
 * 無かった間は、**追加指示を空にして生成を押すと AI に材料が何も無く経路が空で
 * 返った**（#170）。
 */
export const parseReservationInputSchema = z.object({
  origin: manualAware(
    placeSchema.describe(
      '出発地。駅名・建物名・組織名など。職員が入れていなければ空文字列',
    ),
  ),
  destination: manualAware(
    placeSchema.describe(
      '目的地。駅名・建物名・組織名など。職員が入れていなければ空文字列',
    ),
  ),
  round_trip: manualAware(roundTripSchema),
})

export type ParseReservationInput = z.infer<typeof parseReservationInputSchema>

/**
 * 会議の与件のうち、参加可否の選択肢と候補日程の長さを決める2つ。
 *
 * 候補日程を扱う2タスク（参加可否・候補日提案）が共有する。`meeting.parse-candidates`
 * は参加形式を受け取らない — 候補日程を作る段では参加形式が何も決めないため
 * （ADR-0005 の表）。
 */
const meetingContextFields = {
  meeting_format: meetingFormatSchema,
  duration_minutes: durationMinutesSchema,
}

/**
 * `meeting.parse-candidates` の入力（所要時間と、カレンダーの表示範囲）。
 *
 * 既に選択済みの候補日程は送らない。「来月の午後」→「火曜と木曜だけにして」という
 * 書き直しの往復は `sessionId` の会話履歴で成立する。
 *
 * **表示範囲を渡すのは #69 の帰結。** 職員が選べる日付はカレンダーの表示範囲にしか
 * 無いので、範囲を渡さないと生成には成功したのに画面が何も変わらない事態が起きる。
 * 範囲外だと分かるのは AI の側でしか無いので、与件として渡して**範囲外なら聞き返させる**。
 */
export const parseCandidatesInputSchema = z
  .object({
    duration_minutes: durationMinutesSchema,
    calendar_start: isoDateSchema.describe(
      'カレンダーが見せている最初の日。職員が選べるのはこの日から',
    ),
    calendar_end: isoDateSchema.describe(
      'カレンダーが見せている最後の日。職員が選べるのはこの日まで',
    ),
  })
  // 逆向きの範囲は条件として成立しないので、AI に渡す前に弾く。
  .refine(
    ({ calendar_start, calendar_end }) => calendar_start <= calendar_end,
    {
      error: 'カレンダーの表示範囲の終わりが始まりより前です',
    },
  )

export type ParseCandidatesInput = z.infer<typeof parseCandidatesInputSchema>

/**
 * `meeting.parse-availability` の入力（参加形式・所要時間・候補日程の一覧）。
 *
 * 候補日程の一覧を渡すのが ADR-0005 の要（ADR-0003 の撤回そのもの）。AI が答えられる
 * 候補日程は渡した一覧の中にしか無くなる。
 */
export const parseAvailabilityInputSchema = z.object({
  ...meetingContextFields,
  candidates: z
    .array(candidateFieldsSchema)
    .min(1)
    .max(MAX_INPUT_CANDIDATES)
    .describe('参加可否を答える対象の候補日程'),
})

export type ParseAvailabilityInput = z.infer<
  typeof parseAvailabilityInputSchema
>

/**
 * 参加可否表のセルひとつ。
 *
 * **未回答はセルが存在しないことで表す**（表は疎になる）。未定（参加者が答えたが
 * 決まっていない）と未回答（回答の不在）は違う事実で、同じ列挙に入れるとその区別が
 * 値の選び方の問題になる（`CONTEXT.md`「未定」）。
 */
const answerSchema = z.object({
  participant: participantSchema,
  availability: availabilitySchema,
})

const candidateWithAnswersSchema = candidateFieldsSchema.extend({
  answers: z
    .array(answerSchema)
    .describe('この候補日程への回答。未回答の参加者は要素を持たない'),
})

/**
 * `meeting.recommend-schedule` の入力（参加形式・所要時間・名簿・参加可否表）。
 *
 * 候補日程を主キーにネストする。出力が候補日程ごとの評点なので、AI が数える単位と
 * 並びが揃う。
 *
 * 参加者の名簿（`participants`）を明示的に持つ。表が疎なので、名簿が無いと AI は
 * 「セルが無い」と「その参加者が存在しない」を区別できない。
 */
export const recommendScheduleInputSchema = z.object({
  ...meetingContextFields,
  participants: z
    .array(participantSchema)
    .min(1)
    .describe('参加可否を問うた参加者の名簿'),
  candidates: z
    .array(candidateWithAnswersSchema)
    .min(1)
    .max(MAX_INPUT_CANDIDATES)
    .describe('評点を付ける対象の候補日程'),
})

export type RecommendScheduleInput = z.infer<
  typeof recommendScheduleInputSchema
>

/**
 * `playground.free-prompt` の入力（ADR-0020）。**持ち込みシステムプロンプト1つだけ。**
 *
 * この欄がそのまま Runtime の system prompt になる。他4タスクの `input` が「画面の
 * 状態」を運ぶのと違い、ここが運ぶのは**職員が書いた文**そのものである。`prompt` 欄が
 * 運ぶのは**検証メッセージ**（user message としてモデルへ渡る文）のほうである。
 *
 * 空文字を許さないのは、何も指示していない状態の応答を「プロンプトの効き」と
 * 誤読させないため。上限は `prompt` と同じ（既存の Skill 全文を貼っても収まる）。
 */
export const freePromptInputSchema = z.object({
  /*
    空白だけも「書かれなかった」として扱う（ADR-0022 が `prompt` に置いたのと同じ
    判断を、必須の構造化入力であるこちらにも置く）。`min(1)` は空文字しか弾かないので
    足りない。**弾く側に倒す**のは、こちらが必須だからである — 任意の taskId を
    巻き込む `prompt` 側と違い、無かったことにする先が無い。

    画面が送信ボタンで止めるだけでは足りない。この Runtime は curl で直接叩かれる
    （`agentcore dev` の備え付け UI は `taskId` を付けられない）ので、塞ぎたかった
    「指示していない状態の応答をプロンプトの効きと誤読する」がそこで再現する。
  */
  system_prompt: z
    .string()
    .min(1)
    .max(MAX_PROMPT_LENGTH)
    .refine((value) => value.trim() !== '', {
      error: '持ち込みシステムプロンプトが空白だけです',
    })
    .describe('職員が持ち込む system prompt。そのままモデルへ渡る'),
})

export type FreePromptInput = z.infer<typeof freePromptInputSchema>

/**
 * taskId から入力契約を引くための表。`OUTPUT_SCHEMAS` と対称に置く（ADR-0004）。
 *
 * `null` は「自然文だけを受け取る」ことを表す。**いまは1つも無い** — 交通ICが
 * フォーム主導になり（ADR-0017）、4タスクすべてが与件を受け取るようになった。
 * 型は `null` を許したまま残す。
 */
export const INPUT_SCHEMAS = {
  'ic-card.parse-reservation': parseReservationInputSchema,
  'meeting.parse-candidates': parseCandidatesInputSchema,
  'meeting.parse-availability': parseAvailabilityInputSchema,
  'meeting.recommend-schedule': recommendScheduleInputSchema,
  'playground.free-prompt': freePromptInputSchema,
} satisfies Record<TaskId, z.ZodType | null>
