import type { z } from 'zod';
import type {
  ParseAvailabilityInput,
  RecommendScheduleInput,
} from './inputs.js';
import {
  parseAvailabilityInputSchema,
  recommendScheduleInputSchema,
} from './inputs.js';
import {
  OUTPUT_SCHEMAS,
  type ParseAvailabilityOutput,
  parseAvailabilityOutputSchema,
  type RecommendScheduleOutput,
  recommendScheduleOutputSchema,
} from './outputs.js';
import type { TaskId } from './task-ids.js';

/**
 * この1回の応答を検査するスキーマ（ADR-0004 / ADR-0005）。
 *
 * **入力を見ないと言えない不変条件をここで足す。** 出力契約は単独では
 * 「返ってきた候補日程が入力にあるものか」を言えない — 入力を知らないため。
 * 候補日程を識別子で指す2タスク（参加可否・候補日提案）がこれを要る。
 */

/**
 * 出力が指した候補日程のうち、入力に無いもの。
 *
 * WHY 2つの検査で共有するか: 「入力に無い識別子を返した」はモデルの同じ失敗であって、
 * taskId ごとに違う失敗ではない。引き算を2箇所に書くと、片方だけが入力の持ち方の変化
 * （候補日程が入れ子になるなど）に追随して、もう片方が黙って何も弾かなくなる。
 * 抜けと重複の扱いだけが taskId ごとに違い、そこは呼び出し側に残る。
 */
function unexpectedCandidateIds(
  inputCandidates: readonly { id: string }[],
  returnedIds: readonly string[],
): string[] {
  const expected = new Set(inputCandidates.map((candidate) => candidate.id));
  return returnedIds.filter((id) => !expected.has(id));
}

/** 入力に無い候補日程を返したことを言う一文。両方の検査が同じ言い方をする。 */
function unexpectedReason(unexpected: readonly string[]): string {
  return `入力に無い候補日程を返しました（${unexpected.join('、')}）`;
}

/**
 * 提案が入力の候補日程と一致しているかを見る。
 *
 * WHY: 入力に無い候補日程が1つ混ざると順位の抜けになる — 順位は 1..N の順列なので、
 * 入力にある候補日程が1つ順位を失う。画面は落ちた行を無印のまま描き、職員には
 * 「AI が触らなかった候補日程」と見分けが付かない。
 *
 * 突き合わせは**識別子**で行う（ADR-0005）。以前は3項目を連結した鍵を組み立てていたが、
 * それは契約に識別子が無かったからで、その理由は消えた。
 *
 * 一致しない理由の文字列を返す（一致していれば null）。件数ではなく候補日程を名指し
 * するのは、プロンプトの効きを追うのがこの検証環境の目的だから — 何を取りこぼし、
 * 何を作り出したのかが分からないと、Skill の書き方に戻せない。
 */
export function findRecommendationMismatch(
  input: RecommendScheduleInput,
  output: RecommendScheduleOutput,
): string | null {
  const returned = output.recommendations.map((entry) => entry.candidate_id);
  const unexpected = unexpectedCandidateIds(input.candidates, returned);
  const missing = input.candidates
    .map((candidate) => candidate.id)
    .filter((id) => !returned.includes(id));

  if (unexpected.length === 0 && missing.length === 0) return null;

  const reasons: string[] = [];
  if (unexpected.length > 0) reasons.push(unexpectedReason(unexpected));
  if (missing.length > 0) {
    reasons.push(`入力の候補日程が抜けています（${missing.join('、')}）`);
  }
  return `AI の提案が参加可否表と一致しません。${reasons.join('。')}。`;
}

/**
 * 参加可否が入力の候補日程に収まっているかを見る。
 *
 * **候補日提案（`findRecommendationMismatch`）と非対称に、抜けは許す。** 判定できな
 * かった候補日程は要素を持たないと決めた（`outputs.ts`）ので、抜けは失敗ではなく
 * 「AI が答えられなかった」という事実である。画面はそれを「（判定できませんでした）」
 * として聞き返しの対象にする。一方あちらは全候補日程に順位を付けるのが仕事なので、
 * 抜けは順位の抜けそのものになる。
 *
 * 重複は弾く。同じ候補日程に2つの参加可否が返ると、画面はどちらを採るかを決めねば
 * ならず、**その判断はどう決めても参加者の答えではない**（先勝ちなら後で言い直した
 * ほうが捨てられ、後勝ちなら並び順という契約に無い性質に依存する）。
 */
export function findAvailabilityMismatch(
  input: ParseAvailabilityInput,
  output: ParseAvailabilityOutput,
): string | null {
  const returned = output.availability.map((entry) => entry.candidate_id);
  const unexpected = unexpectedCandidateIds(input.candidates, returned);
  const duplicated = returned.filter(
    (id, index) => returned.indexOf(id) !== index,
  );

  if (unexpected.length === 0 && duplicated.length === 0) return null;

  const reasons: string[] = [];
  if (unexpected.length > 0) reasons.push(unexpectedReason(unexpected));
  if (duplicated.length > 0) {
    reasons.push(
      `同じ候補日程に2度答えています（${[...new Set(duplicated)].join('、')}）`,
    );
  }
  return `AI の参加可否が候補日程の一覧と一致しません。${reasons.join('。')}。`;
}

/**
 * 入力を見る検査を出力契約に重ねる。
 *
 * WHY: Runtime はこのスキーマを Structured Output の再試行に使う。素の
 * `OUTPUT_SCHEMAS[taskId]` を渡すと、候補日程を取りこぼした提案が Runtime を
 * 素通りして BFF で初めて落ちる — 順位の重複や抜けは作り直しに回るのに、件数の
 * 不一致だけ回らないという非対称ができる。どちらもモデルの出力が契約に届いて
 * いないという同じ失敗である。
 *
 * BFF もこれを使う。Runtime の再試行を通り抜けたものが最後にもう一度ここで落ちる。
 *
 * 入力の解析に失敗した場合でも出力契約そのものは効かせる。呼び出し側が
 * `checkTaskInput` を通した後なので通常は成功し、失敗していれば入力が壊れている
 * ことは別の経路で既に表に出ている。
 */
export function outputSchemaFor(taskId: TaskId, input: unknown): z.ZodType {
  switch (taskId) {
    case 'meeting.parse-availability': {
      const parsed = parseAvailabilityInputSchema.safeParse(input);
      if (!parsed.success) return OUTPUT_SCHEMAS[taskId];
      return parseAvailabilityOutputSchema.refine(
        (output) => findAvailabilityMismatch(parsed.data, output) === null,
        {
          error:
            '参加可否は入力の候補日程だけを、それぞれ多くとも1度だけ指す必要があります',
        },
      );
    }
    case 'meeting.recommend-schedule': {
      const parsed = recommendScheduleInputSchema.safeParse(input);
      if (!parsed.success) return OUTPUT_SCHEMAS[taskId];
      return recommendScheduleOutputSchema.refine(
        (output) => findRecommendationMismatch(parsed.data, output) === null,
        { error: '提案は入力の候補日程と過不足なく対応している必要があります' },
      );
    }
    default:
      return OUTPUT_SCHEMAS[taskId];
  }
}
