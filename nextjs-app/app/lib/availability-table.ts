// 値として引くのは `meeting.ts` だけ（zod を持たないので SSG のバンドルに乗らない）。
// 入出力契約の型は `import type` で引く（型は emit 時に消える）。
import type {
  DurationMinutes,
  MeetingFormat,
  RecommendScheduleInput,
  TableCandidate,
} from "@contracts/index.js";
import { type Availability, candidateIdOf } from "@contracts/meeting";

/**
 * 候補日提案タブが与件として使う参加可否表のモック。
 *
 * WHY: この画面の参加可否表は読み取り専用で、AI が埋めるのは評点と根拠だけである。
 * 本番では DB のレコードになる部分なので、検証環境では生成器が代わりを務める。
 * サンプルの切り替えボタンが実行時にこれを呼ぶため、**生成器が壊れるとデモの最中に
 * 自明な表が出る** — 純関数として切り出してテストを持つ理由がここにある（#58 のシーム3）。
 */

/**
 * 参加者ひとり。**実名と識別子の両方を持つ。**
 *
 * WHY 2つ持つか: Runtime へ送るのは識別子だけで、実名はブラウザから出ない（ADR-0008）。
 * 一方で職員が読みたいのは「欠席: 山田太郎」であって「欠席: 参加者A」ではない
 * （設計書 4.5.2節の説明責任要件）。名簿がこの対応を持てば、AI の出力に実名が
 * 現れないまま画面には実名が出る。
 */
export type Participant = { id: string; name: string };

/**
 * 生成器が作る範囲。**会議情報（参加形式・所要時間）は含まない。**
 *
 * WHY: あの2つはタブ2で職員が決めるもので、サンプルの表と一緒に振り直してよい値では
 * ない（差し替えのたびに会議の性質が変わってしまう）。リクエストに載せる形へ組み立てるのは
 * `tableInput` の仕事で、生成器が持つのは参加者 × 候補日程の部分だけにする。
 */
export type AvailabilityTable = {
  participants: Participant[];
  candidates: TableCandidate[];
};

/**
 * サンプルの2モード（ストーリー72）。
 *
 * - `complete` — 回答がほぼ揃った表。AI 提案が発火する
 * - `partial` — 回答が途中の表。回答率が発火閾値を下回り、AI 提案は出ない
 *
 * WHY 「別のサンプルに差し替え」を置き換えるか: 同じ性質の表を振り直すだけでは、
 * 職員が確かめたい2つの挙動（提案が出るとき／出ないとき）のうち片方しかデモで
 * 見せられない。乱数で稀に回答率が下がるのを待つ形にすると、見せたい回に見せられない。
 */
export type TableMode = "complete" | "partial";

/**
 * 初期表示の参加可否表を決めるシード。固定値で焼き込む。
 *
 * WHY: SSG なので、初期状態に実行時の乱数を採るとビルド時の HTML とブラウザの
 * 初回描画が食い違う。読み込むたび同じ表になるのはデモでは利点で、同じ入力に
 * 対する AI の出力の揺れだけを観察できる。切り替えボタンだけが実行時に別の
 * シードを配る（ハイドレーション後なので食い違いようがない）。
 */
export const INITIAL_TABLE_SEED = 20261005;

export const PARTICIPANT_COUNT = 5;
export const CANDIDATE_COUNT = 5;

/**
 * 名簿の実名。**Runtime へは送らない**（ADR-0008）。
 *
 * 設計書 4.5.2節の例（山田太郎・佐藤花子）を先頭に置く。人数ぶんだけ持てばよいので
 * 生成には使わず、識別子の順にそのまま対応させる — 名前まで振り直すと、表を
 * 切り替えたときに「同じ参加者が別人になった」ように読める。
 */
const PARTICIPANT_NAMES = [
  "山田太郎",
  "佐藤花子",
  "鈴木一郎",
  "高橋美咲",
  "田中健太",
];

/** `complete` の未回答セル数。1〜2セル置く。 */
const MIN_UNANSWERED = 1;
const MAX_UNANSWERED = 2;

/**
 * `partial` の候補日程ごとの回答数。合計が 25 セルの半分（発火閾値）を下回る組を並べる。
 *
 * どの組にも 1 が2つ入っている。回答率 20% は「参加入力未済」の閾値（30%）を下回るので、
 * **どのシードでもラベルが1つは出る** — 出ないラベルはデモで見せられない。
 */
const PARTIAL_ANSWERED_PATTERNS = [
  [3, 3, 2, 1, 1],
  [3, 2, 2, 1, 1],
  [2, 2, 2, 1, 1],
];

/** `partial` の参加可能人数の最多。回答そのものが少ないので `complete` より低く置く。 */
const PARTIAL_MAX_AVAILABLE = 2;

/**
 * 候補日程の日付を数える起点。固定値にする。
 *
 * WHY: フロントエンドは SSG なので、初期状態に「今日」を採るとビルド時に描いた
 * HTML とブラウザの初回描画が食い違う（候補日程タブの識別子を固定値にしてあるのと
 * 同じ理由）。読み込むたび同じ表になるのはデモでは利点で、同じ入力に対する AI の
 * 出力の揺れだけを観察できる。
 */
const BASE_DATE = "2026-10-05";

/**
 * 起点からの日数。`BASE_DATE` が月曜なので、この10個は平日だけになる。
 *
 * 会議の候補日程に土日を混ぜると、AI が参加可否表ではなく曜日を見て評点を付けた
 * 可能性が残り、表を切り替えて提案が変わることの意味が薄れる。
 */
const WEEKDAY_OFFSETS = [0, 1, 2, 3, 4, 7, 8, 9, 10, 11];

/**
 * 候補日程の開始時刻。日付は全件異なるので、時間帯は表を見分けやすくするために振る。
 *
 * 終了時刻を持たないのは候補日程が終了時刻を持たなくなったため（ADR-0005）。表示上の
 * 終わる時刻は会議の所要時間から導く。
 */
const START_TIMES = ["09:00", "10:00", "13:00", "14:00", "15:00"];

/**
 * `complete` の参加可能人数の最多。**名簿から1人欠けた数**（5人中4人）に固定する。
 *
 * WHY 振らないか: 参加者が5人なので参加可能率は 0/20/40/60/80% しか取れない。3人
 * （60%）を最多にすると、AI が素直に割合から評点を付けるかぎり「推奨」の閾値
 * （`SCORE_THRESHOLDS.recommended` = 0.80）に届く候補日程が1つも無い表になる。
 * ラベルが画面に出ることを見せるのがこの表の役目なので、最多だけは閾値に触れる
 * 数に固定し、揺らすのは誰が・どの候補日程がという中身の側にする。
 *
 * 全員（5人）は作らない — 自明な1位があると提案の余地が無い。
 */
const COMPLETE_MAX_AVAILABLE = PARTICIPANT_COUNT - 1;

/** 出席の2通り。参加形式との整合は画面が持つので、生成器は両方を混ぜる。 */
const ATTENDING: Availability[] = ["attend_onsite", "attend_remote"];

/**
 * 出席しない側の2通り。**欠席と未定を混ぜる**（`CONTEXT.md`「未定」）。
 *
 * WHY: 未定を作らないと、AI が「未定」と「未回答」を書き分けられているかを見る材料が
 * 表に無くなる。`SKILL.md` はこの2つを取り違えないことを制約として書いており、
 * 検証環境が確かめたいのはまさにそこである。
 */
const NOT_ATTENDING: Availability[] = ["absent", "undecided"];

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

function pick<T>(random: () => number, items: readonly T[]): T {
  return items[pickIndex(random, items.length)];
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
function participantIdAt(index: number): string {
  return `参加者${String.fromCharCode("A".charCodeAt(0) + index)}`;
}

/**
 * 候補日程ひとつの作り方。**参加可能人数と回答数を先に決める。**
 *
 * WHY 構成的に決めるか: 各セルを独立に振ると、たまたま自明な表になった回にプロダクト
 * オーナーへ見せてしまう。棄却法で振り直す形も採らない — 何回振れば条件を満たすかが
 * シードに依存し、「同じシードから同じ表」以外の保証が弱くなる。
 */
type CandidatePlan = { attendCount: number; answeredCount: number };

/**
 * `complete` の作り方。3つの制約を構成的に満たす。
 *
 * 1. **全員が参加できる候補日程を作らない** — 自明な1位があると提案の余地が無い
 * 2. **参加可能人数が最多の候補日程を2つ作る** — AI に評点の差の説明を強制する
 * 3. **未回答を1〜2セル置く** — 疎な表が実際に効いているか、AI が未回答を欠席と
 *    混同しないかを見る
 *
 * 未回答は候補日程ごとに多くとも1セルしか落とさない。参加可能人数は先に決めてあるので、
 * 落とす先が出席のセルに当たると最多の同数が崩れる。
 */
function planComplete(random: () => number): CandidatePlan[] {
  const attendCounts = withTiedMaximum(random, COMPLETE_MAX_AVAILABLE, () =>
    pickIndex(random, COMPLETE_MAX_AVAILABLE),
  );

  const unansweredCount =
    MIN_UNANSWERED + pickIndex(random, MAX_UNANSWERED - MIN_UNANSWERED + 1);
  const unansweredAt = new Set(
    shuffled(
      random,
      Array.from({ length: CANDIDATE_COUNT }, (_, index) => index),
    ).slice(0, unansweredCount),
  );

  return attendCounts.map((attendCount, index) => ({
    attendCount,
    answeredCount: PARTICIPANT_COUNT - (unansweredAt.has(index) ? 1 : 0),
  }));
}

/**
 * `partial` の作り方。回答数を先に配り、参加可能人数をその中に収める。
 *
 * 順序が `complete` と逆なのは、回答が少ない候補日程に「回答数を超える参加可能人数」を
 * 割り当てられないため。最多の同数は回答が2件以上ある候補日程の中から2つ選ぶ。
 */
function planPartial(random: () => number): CandidatePlan[] {
  const answeredCounts = shuffled(
    random,
    pick(random, PARTIAL_ANSWERED_PATTERNS),
  );
  const eligible = answeredCounts
    .map((answeredCount, index) => ({ answeredCount, index }))
    .filter((entry) => entry.answeredCount >= PARTIAL_MAX_AVAILABLE)
    .map((entry) => entry.index);
  const tiedAt = new Set(shuffled(random, eligible).slice(0, 2));

  return answeredCounts.map((answeredCount, index) => ({
    answeredCount,
    attendCount: tiedAt.has(index)
      ? PARTIAL_MAX_AVAILABLE
      : Math.min(answeredCount, pickIndex(random, PARTIAL_MAX_AVAILABLE)),
  }));
}

/** 最多をちょうど2つの候補日程に配り、残りはそれより少ない数にする。 */
function withTiedMaximum(
  random: () => number,
  maximum: number,
  below: () => number,
): number[] {
  const tiedAt = new Set(
    shuffled(
      random,
      Array.from({ length: CANDIDATE_COUNT }, (_, index) => index),
    ).slice(0, 2),
  );
  return Array.from({ length: CANDIDATE_COUNT }, (_, index) =>
    tiedAt.has(index) ? maximum : below(),
  );
}

/**
 * 参加可否表を1つ作る。
 *
 * モードによらず守るもの — 参加者5人・候補日程5件、全員が参加できる候補日程は作らない、
 * 参加可能人数が最多の候補日程はちょうど2つ、同じシードからは同じ表。
 */
export function generateAvailabilityTable(
  seed: number,
  mode: TableMode,
): AvailabilityTable {
  const random = createRandom(seed);

  const participants = Array.from(
    { length: PARTICIPANT_COUNT },
    (_, index) => ({
      id: participantIdAt(index),
      name: PARTICIPANT_NAMES[index],
    }),
  );
  const participantIds = participants.map((participant) => participant.id);

  const offsets = shuffled(random, WEEKDAY_OFFSETS)
    .slice(0, CANDIDATE_COUNT)
    .sort((a, b) => a - b);
  const startTimes = shuffled(random, START_TIMES).slice(0, CANDIDATE_COUNT);

  const plans =
    mode === "complete" ? planComplete(random) : planPartial(random);

  const candidates = plans.map((plan, index) => {
    // 回答する参加者を選び、その先頭 `attendCount` 人を出席にする。残りの参加者は
    // セルを持たない（未回答）。
    const answering = shuffled(random, participantIds).slice(
      0,
      plan.answeredCount,
    );
    const attending = new Set(answering.slice(0, plan.attendCount));
    return {
      id: candidateIdOf(index + 1),
      date: addDays(BASE_DATE, offsets[index]),
      start_time: startTimes[index],
      // 表の列は名簿の順で読むので、回答も名簿の順に並べ直す。
      answers: participantIds
        .filter((participant) => answering.includes(participant))
        .map((participant) => ({
          participant,
          availability: attending.has(participant)
            ? pick(random, ATTENDING)
            : pick(random, NOT_ATTENDING),
        })),
    };
  });

  return { participants, candidates };
}

/**
 * 生成した表を Runtime へ送る形へ組み立てる。**実名を落とすのはここ**（ADR-0008）。
 *
 * 会議情報を添えるのも同じ理由でここにある — 生成器が持たないものを1箇所で足す。
 */
export function tableInput(
  table: AvailabilityTable,
  meeting: {
    meeting_format: MeetingFormat;
    duration_minutes: DurationMinutes;
  },
): RecommendScheduleInput {
  return {
    ...meeting,
    participants: table.participants.map((participant) => participant.id),
    candidates: table.candidates,
  };
}

/**
 * 識別子から実名を引く。AI の根拠に識別子が現れた場合もこれで置き換えられる
 * （ADR-0008 の帰結）。名簿に無い識別子は識別子のまま返す。
 */
export function participantNameOf(
  table: AvailabilityTable,
  participantId: string,
): string {
  return (
    table.participants.find((participant) => participant.id === participantId)
      ?.name ?? participantId
  );
}
