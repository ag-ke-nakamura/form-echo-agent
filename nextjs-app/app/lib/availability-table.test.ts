import { recommendScheduleInputSchema } from "@contracts/index.js";
import { describe, expect, it } from "vitest";
import {
  CANDIDATE_COUNT,
  countAttending,
  generateAvailabilityTable,
  PARTICIPANT_COUNT,
} from "./availability-table";

/** リクエストに載せる形。会議情報は画面が添えるので、テストも同じ組み立てをする。 */
const MEETING_CONTEXT = {
  meeting_format: "hybrid",
  duration_minutes: 60,
} as const;

/**
 * 生成器は乱数を使うので、1つのシードだけで見ても不変条件が成り立っているとは
 * 言えない。デモの最中に「別のサンプルに差し替え」を押した回にだけ自明な表が出る、
 * というのが避けたい失敗そのものなので、広めのシードで回す。
 */
const SEEDS = Array.from({ length: 200 }, (_, index) => index);

describe("generateAvailabilityTable", () => {
  it("入力契約に適合した参加可否表を返す", () => {
    for (const seed of SEEDS) {
      const result = recommendScheduleInputSchema.safeParse({
        ...MEETING_CONTEXT,
        ...generateAvailabilityTable(seed),
      });
      expect(result.success, `seed ${seed}`).toBe(true);
    }
  });

  it("参加者5人・候補日程5件になる", () => {
    for (const seed of SEEDS) {
      const table = generateAvailabilityTable(seed);
      expect(table.participants, `seed ${seed}`).toHaveLength(
        PARTICIPANT_COUNT,
      );
      expect(table.candidates, `seed ${seed}`).toHaveLength(CANDIDATE_COUNT);
      expect(new Set(table.participants).size).toBe(PARTICIPANT_COUNT);
      expect(
        new Set(table.candidates.map((candidate) => candidate.id)).size,
      ).toBe(CANDIDATE_COUNT);
    }
  });

  it("全員が参加できる候補日程を作らない", () => {
    for (const seed of SEEDS) {
      const table = generateAvailabilityTable(seed);
      for (const candidate of table.candidates) {
        expect(countAttending(candidate), `seed ${seed}`).toBeLessThan(
          PARTICIPANT_COUNT,
        );
      }
    }
  });

  it("参加可能人数が最多の候補日程をちょうど2つ作る", () => {
    for (const seed of SEEDS) {
      const counts =
        generateAvailabilityTable(seed).candidates.map(countAttending);
      const max = Math.max(...counts);
      expect(
        counts.filter((count) => count === max).length,
        `seed ${seed}`,
      ).toBe(2);
    }
  });

  it("未回答を1〜2セル置く", () => {
    for (const seed of SEEDS) {
      const table = generateAvailabilityTable(seed);
      const answered = table.candidates.reduce(
        (total, candidate) => total + candidate.answers.length,
        0,
      );
      const unanswered = PARTICIPANT_COUNT * CANDIDATE_COUNT - answered;
      expect(unanswered, `seed ${seed}`).toBeGreaterThanOrEqual(1);
      expect(unanswered, `seed ${seed}`).toBeLessThanOrEqual(2);
    }
  });

  it("参加可否が4状態のうち出席以外も混ざる", () => {
    // 未定を作らないと、AI が「未定」と「未回答」を書き分けられているかを見る材料が
    // 表に無くなる。`SKILL.md` はこの2つを取り違えないことを制約として書いている。
    const seen = new Set<string>();
    for (const seed of SEEDS) {
      for (const candidate of generateAvailabilityTable(seed).candidates) {
        for (const answer of candidate.answers) seen.add(answer.availability);
      }
    }
    expect([...seen].sort()).toEqual([
      "absent",
      "attend_onsite",
      "attend_remote",
      "undecided",
    ]);
  });

  it("同じシードから同じ表が出る", () => {
    for (const seed of SEEDS) {
      expect(generateAvailabilityTable(seed)).toEqual(
        generateAvailabilityTable(seed),
      );
    }
  });

  it("シードが違えば違う表が出る", () => {
    const tables = new Set(
      SEEDS.map((seed) => JSON.stringify(generateAvailabilityTable(seed))),
    );
    // 完全な単射までは要らない（デモで見分けが付けば足りる）が、ほとんどのシードで
    // 表が動かないなら「別のサンプルに差し替え」が仕事をしていない。
    expect(tables.size).toBeGreaterThan(SEEDS.length * 0.9);
  });
});
