import { z } from 'zod';
import {
  availabilitySchema,
  candidateFieldsSchema,
  durationMinutesSchema,
  isoDateSchema,
  MAX_PROMPT_LENGTH,
  meetingFormatSchema,
  roundTripSchema,
} from './fields.js';
import { MAX_INPUT_CANDIDATES } from './meeting.js';
import type { TaskId } from './task-ids.js';

/**
 * 参加者ひとりを指す識別子。
 *
 * WHY: 構造化入力は Guardrail チェックとサニタイズの対象にしない（ADR-0004）。
 * 検査を通さない値に自由文字列を許すと、そこが prompt injection の窓になる。
 * この形なら AI が理由に「参加者Bと参加者Dが参加できないため」とそのまま書けて、
 * 表示名を画面側で組み立てる手間も要らない。実名を送らないのは ADR-0008。
 */
const PARTICIPANT = /^参加者[A-Z]$/;

const participantSchema = z
  .string()
  .regex(PARTICIPANT)
  .describe('参加者の識別子。「参加者A」のような形');

/**
 * 職員が手で入れたかどうかを添えた与件（ADR-0018）。
 *
 * WHY 値だけで渡さないか: 出発地・目的地・往復区分は出力にも載る（追加指示で別の
 * 場所や区分が明示されたら AI が直せる必要がある）が、**画面の `isPreserved` は
 * 手入力の欄を守る**ので、AI が手入力の欄を直しても反映されない。値だけを渡すと
 * 「出発地は霞ヶ関のまま、運賃と経路は新宿から」という自己矛盾したフォームができる。
 * 手入力かどうかを知っているのは画面だけなので、画面が渡す（#69 と同じ形）。
 *
 * 食い違ったときにどちらが勝つかの規則は Skill が持つ。ここは印を運ぶだけ。
 */
function manualAware<T extends z.ZodType>(value: T) {
  return z.object({
    value,
    is_manual: z
      .boolean()
      .describe(
        '職員が手で入れた値なら true。既定値のまま、または前回 AI が入れた値なら false',
      ),
  });
}

/**
 * 出発地・目的地の長さの上限（#170）。
 *
 * WHY 縛るか: この2欄は形で縛れない（駅名・建物名・組織名を許す）ので、`input` に
 * 自由文字列を置かないという ADR-0004 の縛りが使えない。代わりに Guardrail チェックへ
 * 通す（ADR-0017）が、それは内容の検査であって長さは見ない。上限が無いと1つの欄で
 * Guardrail の往復とモデルの文脈をいくらでも太らせられる（`MAX_PROMPT_LENGTH` が
 * `prompt` に掛かっているのと同じ理由）。
 *
 * **1,000字は参照ドキュメントに出どころを持たない、我々が決めた値である**（`prompt` の
 * 10,000字は 10.1節が出どころ）。駅名・建物名・組織名に要る長さの見積もりではなく、
 * 「職員が手で打つ欄としてこれを超えたら入力ではない」という線である。
 */
export const MAX_PLACE_LENGTH = 1_000;

/**
 * 出発地または目的地（#170）。**職員がフォームに打った自由文字列。**
 *
 * **空文字列は未入力**を表す。フォームの欄が空のまま生成を押す回があるので、
 * 「打っていない」をそのまま渡せる必要がある — `null` にしないのは、画面の
 * `FormState` がどの欄も文字列で持っており、渡す手前で形を変える理由が無いため。
 */
const placeSchema = z.string().max(MAX_PLACE_LENGTH);

/**
 * `ic-card.parse-reservation` の入力（出発地・目的地・往復区分。#168・#170）。
 *
 * **運賃の額を決める与件だけを載せる**（ADR-0017）。往復区分が無かった間、Skill の
 * 「往復なら往復分」と `fare` の `describe` は AI が往復かどうかを知る手段が無く
 * 死んでいた。出発地・目的地が無かった間は、**追加指示を空にして生成を押すと AI に
 * 材料が何も無く経路が空で返った**（#170）。借りる日・返す日時・利用目的は運賃を
 * 決めないので、引き続き自然文から読み取る側に置く。
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
});

export type ParseReservationInput = z.infer<typeof parseReservationInputSchema>;

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
};

/**
 * `meeting.parse-candidates` の入力（所要時間と、カレンダーの表示範囲）。
 *
 * 既に選択済みの候補日程は送らない。「来月の午後」→「火曜と木曜だけにして」という
 * 書き直しの往復は `sessionId` の会話履歴で成立する。カレンダーで手動選択した分を
 * AI に教える必要があるのは設計書 6.3節だが、設計書はそこを「既存の選択に加算される」
 * という画面側の挙動としてのみ規定していて、AI に既存を教えるとは書いていない。
 *
 * **表示範囲を渡すのは #69 の帰結。** 候補日程を選ぶ非AI経路が2週間のカレンダーに
 * なり、週送りナビゲーションを持たない（#64 Out of Scope）ので、**職員が選べる日付は
 * この範囲にしか無い。** 範囲を渡さないと、AI は「来月の午後」と言われれば素直に
 * 来月を返し、返ってきた候補日程は1件もカレンダーに置けない — 職員から見ると
 * 生成には成功したのに画面が何も変わらない。範囲外だと分かるのは AI の側でしか
 * ないので（暦を解決するのは AI）、与件として渡して**範囲外なら聞き返させる**。
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
  /*
    順序だけ見る。範囲の長さ（2週間）は縛らない — カレンダーが何日ぶん見せるかは
    画面の都合で、契約が決めることではない。逆向きの範囲は条件として成立しないので、
    AI に渡す前に弾く（渡すと必ず0件になり、職員には理由が出ない）。
  */
  .refine(
    ({ calendar_start, calendar_end }) => calendar_start <= calendar_end,
    {
      error: 'カレンダーの表示範囲の終わりが始まりより前です',
    },
  );

export type ParseCandidatesInput = z.infer<typeof parseCandidatesInputSchema>;

/**
 * `meeting.parse-availability` の入力（参加形式・所要時間・候補日程の一覧）。
 *
 * 候補日程の一覧を渡すのが ADR-0005 の要（ADR-0003 の撤回そのもの）。AI が答えられる
 * 候補日程は渡した一覧の中にしか無くなるので、「入力に無いものが返って画面で黙って
 * 落ちる」経路が消える。
 */
export const parseAvailabilityInputSchema = z.object({
  ...meetingContextFields,
  candidates: z
    .array(candidateFieldsSchema)
    .min(1)
    .max(MAX_INPUT_CANDIDATES)
    .describe('参加可否を答える対象の候補日程'),
});

export type ParseAvailabilityInput = z.infer<
  typeof parseAvailabilityInputSchema
>;

/**
 * 参加可否表のセルひとつ。
 *
 * **未回答はセルが存在しないことで表す**（表は疎になる）。未回答を参加可否の値に
 * 足さない — 未定（参加者が答えたが決まっていない）と未回答（回答の不在）は違う事実で、
 * 同じ列挙に入れるとその区別が値の選び方の問題になる（`CONTEXT.md`「未定」）。
 */
const answerSchema = z.object({
  participant: participantSchema,
  availability: availabilitySchema,
});

const candidateWithAnswersSchema = candidateFieldsSchema.extend({
  answers: z
    .array(answerSchema)
    .describe('この候補日程への回答。未回答の参加者は要素を持たない'),
});

/**
 * `meeting.recommend-schedule` の入力（参加形式・所要時間・名簿・参加可否表）。
 *
 * 候補日程を主キーにネストする。出力が候補日程ごとの評点なので、AI が数える単位と
 * 並びが揃う。セルを平坦に並べると同じ候補日程が全セルで繰り返され、参照ドキュメント
 * 13.1節の入力想定を無駄に食う。
 *
 * 参加者の名簿（`participants`）を明示的に持つ。表が疎なので、名簿が無いと AI は
 * 「セルが無い」と「その参加者が存在しない」を区別できず、「5人中3人が参加可能」を
 * 数えられない。
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
});

export type RecommendScheduleInput = z.infer<
  typeof recommendScheduleInputSchema
>;

/**
 * `playground.free-prompt` の入力（ADR-0020）。**持ち込みシステムプロンプト1つだけ。**
 *
 * この欄がそのまま Runtime の system prompt になる。他4タスクの `input` が「画面の
 * 状態」を運ぶのと違い、ここが運ぶのは**職員が書いた文**そのものである。
 *
 * WHY `prompt` ではなく `input` に載せるか: `prompt` 欄が運ぶのは**検証メッセージ**
 * （user message としてモデルへ渡る文）である。逆に載せると、
 * `prompt` の中身がモデルへ user message として渡らない唯一の taskId になり、
 * 契約の欄名と実体が食い違う（ADR-0020 が却下した案）。
 *
 * 空文字を許さないのは、何も指示していない状態の応答を「プロンプトの効き」と
 * 誤読させないため。上限は `prompt` と同じ（既存の Skill 全文を貼っても収まる）。
 */
export const freePromptInputSchema = z.object({
  system_prompt: z
    .string()
    .min(1)
    .max(MAX_PROMPT_LENGTH)
    .describe('職員が持ち込む system prompt。そのままモデルへ渡る'),
});

export type FreePromptInput = z.infer<typeof freePromptInputSchema>;

/**
 * taskId から入力契約を引くための表。`OUTPUT_SCHEMAS` と対称に置く（ADR-0004）。
 *
 * `null` は「自然文だけを受け取る」ことを表す。**いまは1つも無い** — 交通ICが
 * フォーム主導になり（ADR-0017）、4タスクすべてが与件を受け取るようになった。
 * 型は `null` を許したまま残す。書けなくすると、次に「自然文だけ」のタスクが
 * 増えたときに表がその状態を表せない。
 */
export const INPUT_SCHEMAS = {
  'ic-card.parse-reservation': parseReservationInputSchema,
  'meeting.parse-candidates': parseCandidatesInputSchema,
  'meeting.parse-availability': parseAvailabilityInputSchema,
  'meeting.recommend-schedule': recommendScheduleInputSchema,
  'playground.free-prompt': freePromptInputSchema,
} satisfies Record<TaskId, z.ZodType | null>;

/**
 * 構造化入力のうち、Guardrail の入力側で検査する文字列（#170）。
 *
 * **検査の境界は「`prompt` か `input` か」ではなく「人が書いた文字列か、システムが
 * 組み立てた与件か」**（ADR-0017 が ADR-0004 の縛りを引き直した）。交通ICの出発地・
 * 目的地は職員がフォームに打った文なので検査に通し、会議3タブの `input`（参加者と
 * 候補日程の識別子・所要時間・参加可否）はシステムが組み立てた与件なので通さない。
 *
 * **taskId を `switch` で網羅する**（`default` を置かない）。`input` に自由文字列を
 * 足すタスクが増えたとき、ここに足し忘れるとその文字列は検査を1度も通らずモデルへ
 * 届く — #168 で追加指示が任意になった結果、フォームだけで生成した回に入力側の検査が
 * 1度も走らなくなっていたのと同じ穴である。網羅を型に見てもらえば、足し忘れは
 * コンパイルエラーになる。
 *
 * 検査済みの `input` しか渡らないので `parse` で受ける。**`outputSchemaFor` が
 * 同じ状況で `safeParse` とフォールバックを採っているのと向きが逆なのは、外し方が
 * 逆だから** — あちらは入力を読めなくても出力契約そのものは効くので安全側に倒れるが、
 * ここで黙って空を返すと検査そのものが消える。
 */
export function inspectedInputStrings(
  taskId: TaskId,
  input: unknown,
): readonly string[] {
  switch (taskId) {
    case 'ic-card.parse-reservation': {
      const { origin, destination } = parseReservationInputSchema.parse(input);
      return [origin.value, destination.value];
    }
    /*
      持ち込みシステムプロンプトは職員が書いた文そのものなので検査する（ADR-0020）。
      **`prompt`（検証メッセージ）と連結して1回**という形は他タブと変わらない。
    */
    case 'playground.free-prompt':
      return [freePromptInputSchema.parse(input).system_prompt];
    // 会議3タブの与件（識別子・所要時間・参加可否・表示範囲）はシステムが組み立てた。
    case 'meeting.parse-candidates':
    case 'meeting.parse-availability':
    case 'meeting.recommend-schedule':
      return [];
  }
}
