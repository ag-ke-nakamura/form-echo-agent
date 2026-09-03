import type { z } from 'zod';
import { candidateKey } from './candidate-key.js';
import type { RecommendScheduleInput } from './inputs.js';
import { recommendScheduleInputSchema } from './inputs.js';
import {
  OUTPUT_SCHEMAS,
  type RecommendScheduleOutput,
  recommendScheduleOutputSchema,
} from './outputs.js';
import type { TaskId } from './task-ids.js';

/**
 * 提案が入力の候補日程と一致しているかを見る（ADR-0004）。
 *
 * WHY: 抽出系には無かった検査で、入力と出力の両方を見られることから来る。
 * ADR-003 は「AI が候補日程に無い日付を返すとフロントエンドで黙って落ちる」と書いたが、
 * 推薦系ではそれが順位の抜けになる — 順位は 1..N の順列なので、入力に無い候補日程が
 * 1つ混ざると入力にある候補日程が1つ順位を失う。画面は落ちた行を無印のまま描き、
 * 職員には「AI が触らなかった候補日程」と見分けが付かない。
 *
 * 出力契約（`recommendScheduleOutputSchema`）は単独ではこれを言えない。入力を知らないため、
 * 順位が 1..N の順列であることまでしか検査できない。
 *
 * 一致しない理由の文字列を返す（一致していれば null）。件数ではなく候補日程を名指し
 * するのは、プロンプトの効きを追うのがこの検証環境の目的だから — 何を取りこぼし、
 * 何を作り出したのかが分からないと、Skill の書き方に戻せない。
 */
export function findRecommendationMismatch(
  input: RecommendScheduleInput,
  output: RecommendScheduleOutput,
): string | null {
  const expected = new Set(input.candidates.map(candidateKey));
  const returned = new Set(output.recommendations.map(candidateKey));

  const unexpected = [...returned].filter((key) => !expected.has(key));
  const missing = [...expected].filter((key) => !returned.has(key));

  if (unexpected.length === 0 && missing.length === 0) return null;

  const reasons: string[] = [];
  if (unexpected.length > 0) {
    reasons.push(`入力に無い候補日程を返しました（${unexpected.join('、')}）`);
  }
  if (missing.length > 0) {
    reasons.push(`入力の候補日程が抜けています（${missing.join('、')}）`);
  }
  return `AI の提案が参加可否表と一致しません。${reasons.join('。')}。`;
}

/**
 * この1回の応答を検査するスキーマ。**入力を見ないと言えない不変条件をここで足す。**
 *
 * WHY: Runtime はこのスキーマを Structured Output の再試行に使う。素の
 * `OUTPUT_SCHEMAS[taskId]` を渡すと、候補日程を取りこぼした提案が Runtime を
 * 素通りして BFF で初めて落ちる — 順位の重複や抜けは作り直しに回るのに、件数の
 * 不一致だけ回らないという非対称ができる。どちらもモデルの出力が契約に届いて
 * いないという同じ失敗である。
 *
 * BFF もこれを使う。Runtime の再試行を通り抜けたものが最後にもう一度ここで落ちる。
 */
export function outputSchemaFor(taskId: TaskId, input: unknown): z.ZodType {
  if (taskId !== 'meeting.recommend-schedule') return OUTPUT_SCHEMAS[taskId];

  const table = recommendScheduleInputSchema.safeParse(input);
  // 呼び出し側が `checkTaskInput` を通した後なので通常は成功する。失敗した場合でも
  // 出力契約そのものは効かせる（入力が壊れていることは別の経路で既に表に出ている）。
  if (!table.success) return OUTPUT_SCHEMAS[taskId];

  return recommendScheduleOutputSchema.refine(
    (output) => findRecommendationMismatch(table.data, output) === null,
    { error: '提案は入力の候補日程と過不足なく対応している必要があります' },
  );
}
