import type {
  CandidateEvaluation,
  RecommendScheduleInput,
} from "@contracts/index.js";
import { assessCandidates } from "@contracts/recommendation";
import { describe, expect, it } from "vitest";
import type { MeetingInfo } from "./meeting-info";
import {
  applyRecommendation,
  attendanceText,
  byScoreDesc,
  candidateLabelOf,
  currentValue,
  type Decision,
} from "./recommend-form";

const MEETING_INFO: MeetingInfo = {
  name: "定例会",
  durationMinutes: 60,
  format: "hybrid",
};

/** 参加者3人が全員「現地で出席」と答えた表。ラベルは評点だけで決まる。 */
function tableOf(...ids: string[]): RecommendScheduleInput {
  return {
    meeting_format: "hybrid",
    duration_minutes: 60,
    participants: ["参加者A", "参加者B", "参加者C"],
    candidates: ids.map((id, index) => ({
      id,
      date: `2026-10-1${index + 5}`,
      start_time: "13:00",
      answers: ["参加者A", "参加者B", "参加者C"].map((participant) => ({
        participant,
        availability: "attend_onsite" as const,
      })),
    })),
  };
}

function evaluationOf(candidateId: string, score: number): CandidateEvaluation {
  return { candidate_id: candidateId, score, comment: "根拠。" };
}

describe("currentValue", () => {
  it("同じ表に対して作られたものだけを返す", () => {
    // 応答を待つ間にサンプルを切り替えられる。遅れて届いた結果が新しい表の隣に
    // 並ぶと、AI が書いた根拠が事実と食い違ったまま残る。
    expect(currentValue({ seed: 1, value: "提案" }, 1)).toBe("提案");
    expect(currentValue({ seed: 1, value: "提案" }, 2)).toBeNull();
    expect(currentValue(null, 1)).toBeNull();
  });
});

describe("candidateLabelOf", () => {
  it("識別子を日時の表示名に解決する", () => {
    const input = tableOf("candidate-1");
    expect(
      candidateLabelOf(input.candidates, "candidate-1", MEETING_INFO),
    ).toBe("2026-10-15 13:00–14:00");
  });

  it("引けない識別子はそのまま返す", () => {
    const input = tableOf("candidate-1");
    expect(
      candidateLabelOf(input.candidates, "candidate-9", MEETING_INFO),
    ).toBe("candidate-9");
  });
});

describe("attendanceText", () => {
  it("参加可能人数を現地・リモートの内訳付きで書く", () => {
    const input = tableOf("candidate-1");
    const [assessment] = assessCandidates(input, null);
    expect(attendanceText(assessment.metrics)).toBe(
      "3名（現地3名/リモート0名）",
    );
  });
});

describe("byScoreDesc", () => {
  it("評点の高い順に並べ、評点の無い候補日程を末尾に落とす", () => {
    const input = tableOf("candidate-1", "candidate-2", "candidate-3");
    const assessments = assessCandidates(input, [
      evaluationOf("candidate-1", 0.4),
      evaluationOf("candidate-3", 0.9),
    ]);

    expect(
      byScoreDesc(assessments).map((entry) => entry.metrics.candidateId),
    ).toEqual(["candidate-3", "candidate-1", "candidate-2"]);
  });
});

describe("applyRecommendation", () => {
  const input = tableOf("candidate-1", "candidate-2");

  it("「推奨」のうち最高評点を開催日にし、報告に載せる", () => {
    const applied = applyRecommendation(
      input,
      [evaluationOf("candidate-1", 0.85), evaluationOf("candidate-2", 0.95)],
      null,
      MEETING_INFO,
    );

    expect(applied.decision).toEqual({
      candidateId: "candidate-2",
      source: "ai",
    });
    expect(applied.report.updated).toEqual([
      "評点 2件",
      "開催日 2026-10-16 13:00–14:00",
    ]);
    expect(applied.report.preserved).toEqual([]);
  });

  it("手で選んだ候補日程を上書きせず、守ったことを報告に載せる", () => {
    // `message` では代われない。職員から見ると「AI提案を押したのに選択が変わらない」
    // ので、言わないと AI が推奨を出せなかったのか自分の選択が守られたのかが分からない。
    const held: Decision = { candidateId: "candidate-1", source: "manual" };
    const applied = applyRecommendation(
      input,
      [evaluationOf("candidate-1", 0.1), evaluationOf("candidate-2", 0.95)],
      held,
      MEETING_INFO,
    );

    expect(applied.decision).toBe(held);
    expect(applied.report.preserved).toEqual(["自分で選んだ候補日程"]);
  });

  it("AI が選んだ候補日程は次の提案で上書きされる", () => {
    const held: Decision = { candidateId: "candidate-1", source: "ai" };
    const applied = applyRecommendation(
      input,
      [evaluationOf("candidate-1", 0.1), evaluationOf("candidate-2", 0.95)],
      held,
      MEETING_INFO,
    );

    expect(applied.decision).toEqual({
      candidateId: "candidate-2",
      source: "ai",
    });
  });

  it("「推奨」が1つも無ければ選択を動かさない", () => {
    // 無理に1つ選ぶと、AI が推していない候補日程に「AIが生成」の印が付く。
    const applied = applyRecommendation(
      input,
      [evaluationOf("candidate-1", 0.6), evaluationOf("candidate-2", 0.55)],
      null,
      MEETING_INFO,
    );

    expect(applied.decision).toBeNull();
    expect(applied.report.updated).toEqual(["評点 2件"]);
  });

  it("初期選択をそのまま返す（バナーの要約が同じ導出を2度しない）", () => {
    const applied = applyRecommendation(
      input,
      [evaluationOf("candidate-1", 0.9), evaluationOf("candidate-2", 0.75)],
      null,
      MEETING_INFO,
    );

    expect(applied.selection).toEqual({
      hostCandidateId: "candidate-1",
      backupCandidateIds: ["candidate-2"],
    });
  });
});
