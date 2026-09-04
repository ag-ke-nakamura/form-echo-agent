import type {
  AiEvaluationLabel,
  Availability,
  CandidateEvaluation,
  RecommendScheduleInput,
} from "@contracts/index.js";
import {
  assessCandidates,
  initialSelection,
  labelFor,
  RECOMMENDATION_RESPONSE_RATE,
  SCORE_THRESHOLDS,
  shouldRequestRecommendation,
  summarizeCandidate,
  summarizeTable,
  tableResponseRate,
  UNANSWERED_RESPONSE_RATE,
} from "@contracts/recommendation";
import { describe, expect, it } from "vitest";

/**
 * `contracts/recommendation.ts` の導出と集計（ADR-0007）。
 *
 * WHY このテストが `nextjs-app` に住むか: `contracts/` はどのプロジェクトにも属さず、
 * テストランナーを持たない（ADR-0002）。これらの関数を引くのはフロントエンドだけなので、
 * 引く側の CI で回すのが素直である。入力契約そのものの検査は BFF と Runtime の境界の
 * テストが持っているので、ここが見るのは**数え方とラベルの境界値**だけになる。
 */

const PARTICIPANTS = ["参加者A", "参加者B", "参加者C", "参加者D", "参加者E"];

/** 参加可否表を組み立てる。回答を書かなかった参加者はセルを持たない（未回答）。 */
function tableOf(
  ...rows: { id: string; date?: string; start_time?: string; answers: string }[]
): RecommendScheduleInput {
  return {
    meeting_format: "hybrid",
    duration_minutes: 60,
    participants: PARTICIPANTS,
    candidates: rows.map((row) => ({
      id: row.id,
      date: row.date ?? "2026-10-15",
      start_time: row.start_time ?? "13:00",
      // `oxa_-` の1文字ずつが名簿の順に対応する（`_` は未回答）。
      answers: [...row.answers].flatMap((code, index) =>
        code === "_"
          ? []
          : [{ participant: PARTICIPANTS[index], availability: CODES[code] }],
      ),
    })),
  };
}

const CODES: Record<string, Availability> = {
  o: "attend_onsite",
  r: "attend_remote",
  x: "absent",
  u: "undecided",
};

function evaluationOf(candidateId: string, score: number): CandidateEvaluation {
  return { candidate_id: candidateId, score, comment: "根拠。" };
}

describe("summarizeCandidate", () => {
  it("参加可能人数を現地・リモートの内訳付きで数える", () => {
    const input = tableOf({ id: "candidate-1", answers: "oorxu" });
    const metrics = summarizeCandidate(PARTICIPANTS, input.candidates[0]);

    expect(metrics.attendCount).toBe(3);
    expect(metrics.attendOnsiteCount).toBe(2);
    expect(metrics.attendRemoteCount).toBe(1);
  });

  it("欠席者を識別子で名指しし、未定とは分けて数える", () => {
    const input = tableOf({ id: "candidate-1", answers: "oxxuu" });
    const metrics = summarizeCandidate(PARTICIPANTS, input.candidates[0]);

    expect(metrics.absentParticipants).toEqual(["参加者B", "参加者C"]);
    expect(metrics.undecidedCount).toBe(2);
  });

  it("未回答を欠席に数えない", () => {
    // 疎な表のセルの不在は回答の不在であって、欠席という回答ではない
    // （`CONTEXT.md`「未定」）。混ぜると「全員参加できない候補日程」に化ける。
    const input = tableOf({ id: "candidate-1", answers: "ox___" });
    const metrics = summarizeCandidate(PARTICIPANTS, input.candidates[0]);

    expect(metrics.unansweredCount).toBe(3);
    expect(metrics.absentParticipants).toEqual(["参加者B"]);
    expect(metrics.answeredCount).toBe(2);
    expect(metrics.responseRate).toBeCloseTo(0.4);
  });

  it("名簿に無い参加者の回答を数に入れない", () => {
    // 名簿を主にして数える。回答の側から数えると、回答済みと未回答の和が
    // 名簿の人数からずれる。
    const input = tableOf({ id: "candidate-1", answers: "o____" });
    input.candidates[0].answers.push({
      participant: "参加者Z",
      availability: "attend_onsite",
    });
    const metrics = summarizeCandidate(PARTICIPANTS, input.candidates[0]);

    expect(metrics.attendCount).toBe(1);
    expect(metrics.answeredCount + metrics.unansweredCount).toBe(
      PARTICIPANTS.length,
    );
  });
});

describe("tableResponseRate / shouldRequestRecommendation", () => {
  it("埋まっているセルの割合を返す", () => {
    const input = tableOf(
      { id: "candidate-1", answers: "ooooo" },
      { id: "candidate-2", answers: "oo___" },
    );
    expect(tableResponseRate(input)).toBeCloseTo(7 / 10);
  });

  it("発火閾値ちょうどでは提案を求める", () => {
    // 「閾値以上」なので境界は通す側（設計書 10.3節）。境界で出さない側に倒すと、
    // ちょうど半分が答えた表でだけ提案が消える。
    const input = tableOf(
      { id: "candidate-1", answers: "ooooo" },
      { id: "candidate-2", answers: "_____" },
    );
    expect(tableResponseRate(input)).toBeCloseTo(RECOMMENDATION_RESPONSE_RATE);
    expect(shouldRequestRecommendation(input)).toBe(true);
  });

  it("閾値を下回れば提案を求めない", () => {
    const input = tableOf(
      { id: "candidate-1", answers: "oooo_" },
      { id: "candidate-2", answers: "_____" },
    );
    expect(shouldRequestRecommendation(input)).toBe(false);
  });
});

describe("labelFor", () => {
  const answered = summarizeCandidate(
    PARTICIPANTS,
    tableOf({ id: "candidate-1", answers: "ooooo" }).candidates[0],
  );

  it.each([
    [1, "recommended"],
    [SCORE_THRESHOLDS.recommended, "recommended"],
    [SCORE_THRESHOLDS.recommended - 0.01, "backup"],
    [SCORE_THRESHOLDS.backup, "backup"],
    [SCORE_THRESHOLDS.backup - 0.01, "consider"],
    [SCORE_THRESHOLDS.consider, "consider"],
    [SCORE_THRESHOLDS.consider - 0.01, "rejected"],
    [0, "rejected"],
  ] satisfies [number, AiEvaluationLabel][])(
    "評点 %s は %s になる",
    (score, label) => {
      expect(labelFor(answered, score)).toBe(label);
    },
  );

  it("評点が無ければラベルも無い", () => {
    expect(labelFor(answered, null)).toBeNull();
  });

  it("回答率が閾値を下回る候補日程は評点によらず「参加入力未済」になる", () => {
    // 回答が2割しか集まっていない候補日程に AI が高い評点を付けても、それは
    // 「集まった2割が出られる」以上のことを言っていない（ADR-0007）。
    const sparse = summarizeCandidate(
      PARTICIPANTS,
      tableOf({ id: "candidate-1", answers: "o____" }).candidates[0],
    );
    expect(sparse.responseRate).toBeLessThan(UNANSWERED_RESPONSE_RATE);
    expect(labelFor(sparse, 0.95)).toBe("unanswered");
  });

  it("全員が欠席と答えた候補日程は「参加入力未済」にならない", () => {
    // 設計書 7.2節（参加可能率29%以下）と 10.3節（回答率30%未満）が矛盾している
    // 箇所。語義どおり回答率を採るので、回答率100%のこの表は評点で決まる。
    const allAbsent = summarizeCandidate(
      PARTICIPANTS,
      tableOf({ id: "candidate-1", answers: "xxxxx" }).candidates[0],
    );
    expect(labelFor(allAbsent, 0.1)).toBe("rejected");
  });
});

describe("assessCandidates", () => {
  it("評点の無い候補日程でも集計値と「参加入力未済」は出る", () => {
    const input = tableOf(
      { id: "candidate-1", answers: "ooxu_" },
      { id: "candidate-2", answers: "o____" },
    );
    const assessments = assessCandidates(input, null);

    expect(assessments.map((entry) => entry.label)).toEqual([
      null,
      "unanswered",
    ]);
    expect(assessments[0].metrics.attendCount).toBe(2);
    expect(assessments[0].score).toBeNull();
  });

  it("並びは入力の候補日程のまま", () => {
    const input = tableOf(
      { id: "candidate-1", answers: "xxxxx" },
      { id: "candidate-2", answers: "ooooo" },
    );
    const assessments = assessCandidates(input, [
      evaluationOf("candidate-2", 0.9),
      evaluationOf("candidate-1", 0.2),
    ]);

    expect(assessments.map((entry) => entry.metrics.candidateId)).toEqual([
      "candidate-1",
      "candidate-2",
    ]);
    expect(assessments.map((entry) => entry.label)).toEqual([
      "rejected",
      "recommended",
    ]);
  });
});

describe("initialSelection", () => {
  it("「推奨」のうち最高評点を開催日にし、「予備に提案」を予備日にする", () => {
    const input = tableOf(
      { id: "candidate-1", answers: "ooooo" },
      { id: "candidate-2", answers: "ooooo" },
      { id: "candidate-3", answers: "ooooo" },
    );
    const selection = initialSelection(input, [
      evaluationOf("candidate-1", 0.85),
      evaluationOf("candidate-2", 0.95),
      evaluationOf("candidate-3", 0.75),
    ]);

    expect(selection.hostCandidateId).toBe("candidate-2");
    expect(selection.backupCandidateIds).toEqual(["candidate-3"]);
  });

  it("同点なら日時が早いほうを開催日にする", () => {
    const input = tableOf(
      { id: "candidate-1", date: "2026-10-16", answers: "ooooo" },
      { id: "candidate-2", date: "2026-10-15", answers: "ooooo" },
    );
    const selection = initialSelection(input, [
      evaluationOf("candidate-1", 0.9),
      evaluationOf("candidate-2", 0.9),
    ]);

    expect(selection.hostCandidateId).toBe("candidate-2");
  });

  it("日時も同じなら現地で参加できる人数が多いほうを開催日にする", () => {
    const input = tableOf(
      { id: "candidate-1", answers: "rrrrr" },
      { id: "candidate-2", answers: "ooooo" },
    );
    const selection = initialSelection(input, [
      evaluationOf("candidate-1", 0.9),
      evaluationOf("candidate-2", 0.9),
    ]);

    expect(selection.hostCandidateId).toBe("candidate-2");
  });

  it("「推奨」が無ければ開催日を決めない", () => {
    // 無理に1つ選ぶと、AI が推していない候補日程に「AIが生成」の印が付く。
    const input = tableOf({ id: "candidate-1", answers: "ooooo" });
    const selection = initialSelection(input, [
      evaluationOf("candidate-1", 0.6),
    ]);

    expect(selection.hostCandidateId).toBeNull();
    expect(selection.backupCandidateIds).toEqual([]);
  });

  it("回答率の低い候補日程は高評点でも開催日にならない", () => {
    const input = tableOf(
      { id: "candidate-1", answers: "o____" },
      { id: "candidate-2", answers: "ooooo" },
    );
    const selection = initialSelection(input, [
      evaluationOf("candidate-1", 0.99),
      evaluationOf("candidate-2", 0.85),
    ]);

    expect(selection.hostCandidateId).toBe("candidate-2");
  });
});

describe("summarizeTable", () => {
  it("候補日程ごとに1つずつ、入力の並びで返す", () => {
    const input = tableOf(
      { id: "candidate-1", answers: "ooooo" },
      { id: "candidate-2", answers: "_____" },
    );
    expect(summarizeTable(input).map((metrics) => metrics.candidateId)).toEqual(
      ["candidate-1", "candidate-2"],
    );
  });
});
