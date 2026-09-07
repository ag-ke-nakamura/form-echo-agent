import { z } from 'zod';
import {
  availabilitySchema,
  candidateFieldsSchema,
  durationMinutesSchema,
  isoDateSchema,
  meetingFormatSchema,
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
 * taskId から入力契約を引くための表。`OUTPUT_SCHEMAS` と対称に置く（ADR-0004）。
 *
 * `null` は「自然文だけを受け取る」ことを表す。省略せずに書くのは
 * `domain-agent.ts` の `tools: []` と同じ理由で、**まだ足していないのか、
 * 足さないと決めたのかを区別する**ため。交通ICが `null` のまま残るのは
 * ADR-0005 の判断で、送るべき画面状態が無い（基準時刻は system prompt が持つ）。
 */
export const INPUT_SCHEMAS = {
  'ic-card.parse-reservation': null,
  'meeting.parse-candidates': parseCandidatesInputSchema,
  'meeting.parse-availability': parseAvailabilityInputSchema,
  'meeting.recommend-schedule': recommendScheduleInputSchema,
} satisfies Record<TaskId, z.ZodType | null>;
