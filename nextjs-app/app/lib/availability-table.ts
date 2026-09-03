import type { RecommendScheduleInput } from "@contracts/index.js";

/**
 * 候補日提案タブが与件として使う参加可否表のモック。
 *
 * WHY: この画面の参加可否表は読み取り専用で、AI が埋めるのは順位と理由だけである。
 * 本番では DB のレコードになる部分なので、検証環境では生成器が代わりを務める。
 * 「別のサンプルに差し替え」ボタンが実行時にこれを呼ぶため、**生成器が壊れると
 * デモの最中に自明な表が出る** — 純関数として切り出してテストを持つ理由がここにある
 * （#58 のシーム3）。
 */

/**
 * 初期表示の参加可否表を決めるシード。固定値で焼き込む。
 *
 * WHY: SSG なので、初期状態に実行時の乱数を採るとビルド時の HTML とブラウザの
 * 初回描画が食い違う。読み込むたび同じ表になるのはデモでは利点で、同じ入力に
 * 対する AI の出力の揺れだけを観察できる。差し替えボタンだけが実行時に別の
 * シードを配る（ハイドレーション後なので食い違いようがない）。
 */
export const INITIAL_TABLE_SEED = 20261005;

export const PARTICIPANT_COUNT = 5;
export const CANDIDATE_COUNT = 5;

/** 未回答のセル数。1〜2セル置く。 */
const MIN_UNANSWERED = 1;
const MAX_UNANSWERED = 2;

/**
 * 候補日程の日付を数える起点。固定値にする。
 *
 * WHY: フロントエンドは SSG なので、初期状態に「今日」を採るとビルド時に描いた
 * HTML とブラウザの初回描画が食い違う（候補日程タブの行識別子を固定値にしてあるのと
 * 同じ理由）。読み込むたび同じ表になるのはデモでは利点で、同じ入力に対する AI の
 * 出力の揺れだけを観察できる。
 */
const BASE_DATE = "2026-10-05";

/**
 * 起点からの日数。`BASE_DATE` が月曜なので、この10個は平日だけになる。
 *
 * 会議の候補日程に土日を混ぜると、AI が参加可否表ではなく曜日を見て順位を付けた
 * 可能性が残り、表を差し替えて提案が変わることの意味が薄れる。
 */
const WEEKDAY_OFFSETS = [0, 1, 2, 3, 4, 7, 8, 9, 10, 11];

/**
 * 候補日程の時間帯。日付は全件異なるので、時間帯は表を見分けやすくするために振る。
 *
 * 同じ日に2つの候補日程を置く形（契約が3項目の組をキーにしている理由そのもの）は
 * このモックでは作らない。不変条件を1つ増やすほど自明でない表を作る自由度が減り、
 * 生成器が「最多○の同数を2つ」を満たせなくなる余地が出る。3項目の組で引くことは
 * 画面と BFF の突き合わせで常に効いている。
 */
const SLOTS = [
  { start_time: "09:00", end_time: "12:00" },
  { start_time: "10:00", end_time: "12:00" },
  { start_time: "13:00", end_time: "16:00" },
  { start_time: "14:00", end_time: "17:00" },
  { start_time: "15:00", end_time: "18:00" },
];

/**
 * 最多○の人数。全員（5人）は作らないので4が上限。
 *
 * 3を下回ると「誰も集まれない表」になり、順位の説明が「どれも駄目」で済んでしまう。
 */
const MAX_AVAILABLE_CHOICES = [3, 4];

/**
 * シードから決まる擬似乱数（mulberry32）。
 *
 * `Math.random` を使わないのは、生成器が「同じシードから同じ表」を返す必要があるため。
 * ビルド時に焼き込んだ表とテストの再現性の両方がここに乗っている。
 */
function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickIndex(random: () => number, length: number): number {
  return Math.floor(random() * length);
}

/** 先頭 `count` 件だけを使う前提の部分シャッフル（Fisher-Yates）。 */
function shuffled<T>(random: () => number, items: readonly T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = pickIndex(random, i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function addDays(date: string, days: number): string {
  const shifted = new Date(`${date}T00:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

/** 参加者の識別子。入力契約の `/^参加者[A-Z]$/` に適合させる。 */
function participantAt(index: number): string {
  return `参加者${String.fromCharCode("A".charCodeAt(0) + index)}`;
}

/**
 * その候補日程に参加できると答えた人数。未回答は数えない。
 *
 * 画面（○の数の列）とテスト（最多○の同数が2つ）の両方から引く。数え方を2箇所に
 * 書くと、片方が未回答を×に畳んだ瞬間に表の見え方と不変条件が食い違う。
 */
export function countAvailable(
  candidate: RecommendScheduleInput["candidates"][number],
): number {
  return candidate.answers.filter((answer) => answer.available).length;
}

/**
 * 参加可否表を1つ作る。
 *
 * 偏りを乱数任せにせず、3つの制約を構成的に満たす。
 *
 * 1. **全員が○の候補日程を作らない** — 自明な1位があると提案の余地が無い
 * 2. **最多○が同数の候補日程を2つ作る** — AI に順位付けの説明を強制する
 *    （同順位は出力契約が弾くので、どちらを上に置いたかを言うしかなくなる）
 * 3. **未回答を1〜2セル置く** — 疎な表が実際に効いているか、AI が未回答を×と
 *    混同しないかを見る
 *
 * 純粋な乱数（各セルを独立に振る）だと、たまたま自明な表になった回にプロダクト
 * オーナーへ見せてしまう。棄却法で振り直す形も採らない — 何回振れば条件を満たすかが
 * シードに依存し、「同じシードから同じ表」以外の保証が弱くなる。
 */
export function generateAvailabilityTable(
  seed: number,
): RecommendScheduleInput {
  const random = createRandom(seed);

  const participants = Array.from({ length: PARTICIPANT_COUNT }, (_, index) =>
    participantAt(index),
  );

  const offsets = shuffled(random, WEEKDAY_OFFSETS)
    .slice(0, CANDIDATE_COUNT)
    .sort((a, b) => a - b);
  const slots = shuffled(random, SLOTS).slice(0, CANDIDATE_COUNT);

  // 最多○を2つの候補日程に配り、残りはそれより少ない数にする。
  const maxAvailable =
    MAX_AVAILABLE_CHOICES[pickIndex(random, MAX_AVAILABLE_CHOICES.length)];
  const tiedIndexes = shuffled(
    random,
    Array.from({ length: CANDIDATE_COUNT }, (_, index) => index),
  ).slice(0, 2);
  const availableCounts = Array.from({ length: CANDIDATE_COUNT }, (_, index) =>
    tiedIndexes.includes(index)
      ? maxAvailable
      : pickIndex(random, maxAvailable),
  );

  const candidates = availableCounts.map((availableCount, index) => {
    const available = new Set(
      shuffled(random, participants).slice(0, availableCount),
    );
    return {
      date: addDays(BASE_DATE, offsets[index]),
      ...slots[index],
      answers: participants.map((participant) => ({
        participant,
        available: available.has(participant),
      })),
    };
  });

  // 未回答は×のセルからだけ落とす。○を落とすと最多○の同数が崩れる。
  const unansweredCount =
    MIN_UNANSWERED + pickIndex(random, MAX_UNANSWERED - MIN_UNANSWERED + 1);
  const negativeCells = candidates.flatMap((candidate, candidateIndex) =>
    candidate.answers
      .map((answer, answerIndex) => ({ candidateIndex, answerIndex, answer }))
      .filter((cell) => !cell.answer.available),
  );
  for (const cell of shuffled(random, negativeCells).slice(
    0,
    unansweredCount,
  )) {
    const candidate = candidates[cell.candidateIndex];
    candidate.answers = candidate.answers.filter(
      (answer) => answer !== cell.answer,
    );
  }

  return { participants, candidates };
}
