import { recommendScheduleInputSchema } from "@contracts/index.js";
import {
  RECOMMENDATION_RESPONSE_RATE,
  shouldRequestRecommendation,
  summarizeCandidate,
  tableResponseRate,
  UNANSWERED_RESPONSE_RATE,
} from "@contracts/recommendation";
import { describe, expect, it } from "vitest";
import {
  type AvailabilityTable,
  CANDIDATE_COUNT,
  generateAvailabilityTable,
  PARTICIPANT_COUNT,
  participantNameOf,
  type TableMode,
  tableInput,
} from "./availability-table";

/** リクエストに載せる形。会議情報は画面が添えるので、テストも同じ組み立てをする。 */
const MEETING_CONTEXT = {
  meeting_format: "hybrid",
  duration_minutes: 60,
} as const;

/**
 * 生成器は乱数を使うので、1つのシードだけで見ても不変条件が成り立っているとは
 * 言えない。デモの最中にサンプルを切り替えた回にだけ自明な表が出る、というのが
 * 避けたい失敗そのものなので、広めのシードで回す。
 */
const SEEDS = Array.from({ length: 200 }, (_, index) => index);

const MODES: TableMode[] = ["complete", "partial"];

/** 名簿の解決だけを見るテストが使う、1つの表。 */
const INITIAL_SEED = 1;

function attendCounts(table: AvailabilityTable): number[] {
  const participantIds = table.participants.map(
    (participant) => participant.id,
  );
  return table.candidates.map(
    (candidate) => summarizeCandidate(participantIds, candidate).attendCount,
  );
}

describe.each(MODES)("generateAvailabilityTable（%s）", (mode) => {
  it("入力契約に適合した参加可否表を返す", () => {
    for (const seed of SEEDS) {
      const result = recommendScheduleInputSchema.safeParse(
        tableInput(generateAvailabilityTable(seed, mode), MEETING_CONTEXT),
      );
      expect(result.success, `seed ${seed}`).toBe(true);
    }
  });

  it("参加者5人・候補日程5件になる", () => {
    for (const seed of SEEDS) {
      const table = generateAvailabilityTable(seed, mode);
      expect(table.participants, `seed ${seed}`).toHaveLength(
        PARTICIPANT_COUNT,
      );
      expect(table.candidates, `seed ${seed}`).toHaveLength(CANDIDATE_COUNT);
      expect(
        new Set(table.participants.map((participant) => participant.id)).size,
      ).toBe(PARTICIPANT_COUNT);
      expect(
        new Set(table.candidates.map((candidate) => candidate.id)).size,
      ).toBe(CANDIDATE_COUNT);
    }
  });

  it("名簿が識別子と実名の両方を持つ", () => {
    // Runtime へ送るのは識別子だけで、実名はブラウザから出ない（ADR-0008）。
    // 実名が無いと設計書 4.5.2節の「欠席者名」を画面に出せない。
    for (const seed of SEEDS) {
      const table = generateAvailabilityTable(seed, mode);
      for (const participant of table.participants) {
        expect(participant.id, `seed ${seed}`).toMatch(/^参加者[A-Z]$/);
        expect(participant.name, `seed ${seed}`).not.toBe(participant.id);
        expect(participant.name.length, `seed ${seed}`).toBeGreaterThan(0);
      }
      expect(new Set(table.participants.map((p) => p.name)).size).toBe(
        PARTICIPANT_COUNT,
      );
    }
  });

  it("実名は Runtime へ送る形に入らない", () => {
    for (const seed of SEEDS) {
      const table = generateAvailabilityTable(seed, mode);
      const serialized = JSON.stringify(tableInput(table, MEETING_CONTEXT));
      for (const participant of table.participants) {
        expect(serialized, `seed ${seed}`).not.toContain(participant.name);
      }
    }
  });

  it("全員が参加できる候補日程を作らない", () => {
    for (const seed of SEEDS) {
      for (const count of attendCounts(generateAvailabilityTable(seed, mode))) {
        expect(count, `seed ${seed}`).toBeLessThan(PARTICIPANT_COUNT);
      }
    }
  });

  it("参加可能人数が最多の候補日程をちょうど2つ作る", () => {
    for (const seed of SEEDS) {
      const counts = attendCounts(generateAvailabilityTable(seed, mode));
      const max = Math.max(...counts);
      expect(
        counts.filter((count) => count === max).length,
        `seed ${seed}`,
      ).toBe(2);
    }
  });

  it("参加可否が4状態のうち出席以外も混ざる", () => {
    // 未定を作らないと、AI が「未定」と「未回答」を書き分けられているかを見る材料が
    // 表に無くなる。`SKILL.md` はこの2つを取り違えないことを制約として書いている。
    const seen = new Set<string>();
    for (const seed of SEEDS) {
      for (const candidate of generateAvailabilityTable(seed, mode)
        .candidates) {
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
      expect(generateAvailabilityTable(seed, mode)).toEqual(
        generateAvailabilityTable(seed, mode),
      );
    }
  });

  it("シードが違えば違う表が出る", () => {
    const tables = new Set(
      SEEDS.map((seed) =>
        JSON.stringify(generateAvailabilityTable(seed, mode)),
      ),
    );
    // 完全な単射までは要らない（デモで見分けが付けば足りる）が、ほとんどのシードで
    // 表が動かないなら切り替えが仕事をしていない。
    expect(tables.size).toBeGreaterThan(SEEDS.length * 0.9);
  });
});

describe("モードの違い", () => {
  it("complete は未回答を1〜2セルに留める", () => {
    for (const seed of SEEDS) {
      const table = generateAvailabilityTable(seed, "complete");
      const answered = table.candidates.reduce(
        (total, candidate) => total + candidate.answers.length,
        0,
      );
      const unanswered = PARTICIPANT_COUNT * CANDIDATE_COUNT - answered;
      expect(unanswered, `seed ${seed}`).toBeGreaterThanOrEqual(1);
      expect(unanswered, `seed ${seed}`).toBeLessThanOrEqual(2);
    }
  });

  it("complete は AI 提案の発火閾値を満たす", () => {
    for (const seed of SEEDS) {
      const input = tableInput(
        generateAvailabilityTable(seed, "complete"),
        MEETING_CONTEXT,
      );
      expect(shouldRequestRecommendation(input), `seed ${seed}`).toBe(true);
    }
  });

  it("partial は AI 提案の発火閾値を下回る", () => {
    // ストーリー71（回答が揃っていないときは AI 提案が出ない）をデモで見せるための
    // モードなので、閾値を下回ることが定義そのものになる。
    for (const seed of SEEDS) {
      const input = tableInput(
        generateAvailabilityTable(seed, "partial"),
        MEETING_CONTEXT,
      );
      expect(tableResponseRate(input), `seed ${seed}`).toBeLessThan(
        RECOMMENDATION_RESPONSE_RATE,
      );
      expect(shouldRequestRecommendation(input), `seed ${seed}`).toBe(false);
    }
  });

  it("partial は「参加入力未済」になる候補日程を必ず含む", () => {
    for (const seed of SEEDS) {
      const table = generateAvailabilityTable(seed, "partial");
      const participantIds = table.participants.map((p) => p.id);
      const rates = table.candidates.map(
        (candidate) =>
          summarizeCandidate(participantIds, candidate).responseRate,
      );
      expect(
        rates.some((rate) => rate < UNANSWERED_RESPONSE_RATE),
        `seed ${seed}`,
      ).toBe(true);
    }
  });
});

describe("participantNameOf", () => {
  it("識別子を名簿の実名に解決する", () => {
    const table = generateAvailabilityTable(INITIAL_SEED, "complete");
    const first = table.participants[0];
    expect(participantNameOf(table, first.id)).toBe(first.name);
  });

  it("名簿に無い識別子は識別子のまま返す", () => {
    // AI の根拠に知らない識別子が現れても、画面から文字が消えないほうがよい。
    const table = generateAvailabilityTable(INITIAL_SEED, "complete");
    expect(participantNameOf(table, "参加者Z")).toBe("参加者Z");
  });
});
