import { z } from 'zod';
import {
  candidateFieldsSchema,
  END_AFTER_START_ERROR,
  endsAfterStart,
} from './fields.js';
import type { TaskId } from './task-ids.js';

/**
 * 参加者ひとりを指す識別子。
 *
 * WHY: 構造化入力は Guardrail チェックとサニタイズの対象にしない（ADR-0004）。
 * 検査を通さない値に自由文字列を許すと、そこが prompt injection の窓になる。
 * この形なら AI が理由に「参加者Bと参加者Dが参加できないため」とそのまま書けて、
 * 表示名を画面側で組み立てる手間も要らない。
 */
const PARTICIPANT = /^参加者[A-Z]$/;

const participantSchema = z
  .string()
  .regex(PARTICIPANT)
  .describe('参加者の識別子。「参加者A」のような形');

/**
 * 参加可否表のセルひとつ。
 *
 * **未回答はセルが存在しないことで表す**（表は疎になる）。参加可否を3値にすると
 * ○×の2値という定義（`CONTEXT.md`）が崩れ、`maybe` を却下したときの論法に自分で当たる。
 * × に畳むのは論外で、「まだ誰も答えていない候補日程」が「全員参加できない候補日程」に
 * 化け、AI が書く理由が嘘になる。
 */
const answerSchema = z.object({
  participant: participantSchema,
  available: z
    .boolean()
    .describe('その候補日程に参加できるなら true、できないなら false'),
});

const candidateWithAnswersSchema = candidateFieldsSchema
  .extend({
    answers: z
      .array(answerSchema)
      .describe('この候補日程への回答。未回答の参加者は要素を持たない'),
  })
  .refine(endsAfterStart, END_AFTER_START_ERROR);

/**
 * `meeting.recommend-schedule` の入力（参加可否表）。
 *
 * 候補日程を主キーにネストする。出力が候補日程ごとの順位なので、AI が数える単位と
 * 並びが揃う。セルを平坦に並べると同じ3項目の組が全セルで繰り返され、参照ドキュメント
 * 13.1節の入力想定を無駄に食う。
 *
 * 参加者の名簿（`participants`）を明示的に持つ。表が疎なので、名簿が無いと AI は
 * 「セルが無い」と「その参加者が存在しない」を区別できず、「5人中3人が参加可能」を
 * 数えられない。
 */
export const recommendScheduleInputSchema = z.object({
  participants: z
    .array(participantSchema)
    .min(1)
    .describe('参加可否を問うた参加者の名簿'),
  candidates: z
    .array(candidateWithAnswersSchema)
    .min(1)
    .describe('順位を付ける対象の候補日程'),
});

export type RecommendScheduleInput = z.infer<
  typeof recommendScheduleInputSchema
>;

/**
 * taskId から入力契約を引くための表。`OUTPUT_SCHEMAS` と対称に置く（ADR-0004）。
 *
 * `null` は「自然文だけを受け取る」ことを表す。省略せずに書くのは
 * `domain-agent.ts` の `tools: []` と同じ理由で、**まだ足していないのか、
 * 足さないと決めたのかを区別する**ため。
 */
export const INPUT_SCHEMAS = {
  'ic-card.parse-reservation': null,
  'meeting.parse-candidates': null,
  'meeting.parse-availability': null,
  'meeting.recommend-schedule': recommendScheduleInputSchema,
} satisfies Record<TaskId, z.ZodType | null>;
