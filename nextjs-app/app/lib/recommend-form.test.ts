import type {
  CandidateEvaluation,
  RecommendScheduleInput,
} from "@contracts/index.js";
import { assessCandidates } from "@contracts/recommendation";
import { describe, expect, it } from "vitest";
import type { MeetingInfo } from "./meeting-info";
import {
  absentText,
  applyRecommendation,
  attendanceText,
  bannerTone,
  byScoreDesc,
  candidateLabelOf,
  chooseHost,
  confirmationSummary,
  confirmedText,
  currentValue,
  INITIAL_CHOICE,
  initialOpenGrounds,
  labelsText,
  type ScheduleChoice,
  selectionText,
  splitRejected,
  toggleBackup,
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

describe("absentText", () => {
  it("欠席者がいなければ「なし」と書く", () => {
    expect(absentText([])).toBe("なし");
  });

  it("5名までは実名を並べる", () => {
    const names = ["山田", "佐藤", "鈴木", "高橋", "田中"];
    expect(absentText(names)).toBe("山田、佐藤、鈴木、高橋、田中");
  });

  it("5名を超えたら先頭5名と「他N名」に畳む", () => {
    // 設計書 4.5.2節。誰が出られないかで判断が変わるので実名を出すが、名簿が
    // 大きい会議では行が伸びて根拠の他の項目が読めなくなる。
    const names = ["山田", "佐藤", "鈴木", "高橋", "田中", "伊藤", "渡辺"];
    expect(absentText(names)).toBe("山田、佐藤、鈴木、高橋、田中 他2名");
  });
});

describe("labelsText / selectionText", () => {
  const input = tableOf("candidate-1", "candidate-2", "candidate-3");

  it("空なら「なし」、あれば読点で連ねる", () => {
    expect(labelsText([])).toBe("なし");
    expect(labelsText(["A", "B"])).toBe("A、B");
  });

  it("推奨と予備を表示名の1行ずつにする", () => {
    expect(
      selectionText(
        {
          hostCandidateId: "candidate-1",
          backupCandidateIds: ["candidate-2", "candidate-3"],
        },
        input.candidates,
        MEETING_INFO,
      ),
    ).toEqual({
      hostText: "2026-10-15 13:00–14:00",
      backupText: "2026-10-16 13:00–14:00、2026-10-17 13:00–14:00",
    });
  });

  it("推せる候補日程が無ければどちらも「なし」", () => {
    expect(
      selectionText(
        { hostCandidateId: null, backupCandidateIds: [] },
        input.candidates,
        MEETING_INFO,
      ),
    ).toEqual({ hostText: "なし", backupText: "なし" });
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

describe("splitRejected", () => {
  const input = tableOf("candidate-1", "candidate-2", "candidate-3");

  it("「条件合わず」だけを折りたたむ側へ分け、どちらも評点の高い順に並べる", () => {
    const assessments = assessCandidates(input, [
      evaluationOf("candidate-1", 0.2),
      evaluationOf("candidate-2", 0.9),
      evaluationOf("candidate-3", 0.75),
    ]);
    const split = splitRejected(assessments);

    expect(split.shown.map((entry) => entry.metrics.candidateId)).toEqual([
      "candidate-2",
      "candidate-3",
    ]);
    expect(split.rejected.map((entry) => entry.metrics.candidateId)).toEqual([
      "candidate-1",
    ]);
  });

  it("提案の前は1件も折りたたまない", () => {
    // ラベルの無い候補日程を却下側へ落とすと、提案が来る前の画面が「全件が条件
    // 合わず」に見える。
    const split = splitRejected(assessCandidates(input, null));

    expect(split.shown).toHaveLength(3);
    expect(split.rejected).toHaveLength(0);
  });
});

describe("initialOpenGrounds", () => {
  it("「推奨」の根拠だけを初期展開にする", () => {
    // 設計書 4.5節。全部開くとスクロールが長い（ストーリー65）。
    const input = tableOf("candidate-1", "candidate-2", "candidate-3");
    const assessments = assessCandidates(input, [
      evaluationOf("candidate-1", 0.9),
      evaluationOf("candidate-2", 0.75),
      evaluationOf("candidate-3", 0.2),
    ]);

    expect(initialOpenGrounds(assessments)).toEqual(["candidate-1"]);
  });
});

describe("bannerTone", () => {
  it("推奨か予備があれば通常の書式", () => {
    expect(
      bannerTone({ hostCandidateId: "candidate-1", backupCandidateIds: [] }),
    ).toBe("info");
    expect(
      bannerTone({
        hostCandidateId: null,
        backupCandidateIds: ["candidate-2"],
      }),
    ).toBe("info");
  });

  it("推奨も予備も無ければ警告の書式に変わる", () => {
    // 設計書 3.3節は「全ての候補が条件合わず」を条件にしているが、判定は
    // 「AI が推せる候補が1つも無い」で採る。要検討だけが並ぶ表でも、青い枠に
    // 「推奨: なし／予備: なし」と出るのは結論を伝えていない。
    expect(bannerTone({ hostCandidateId: null, backupCandidateIds: [] })).toBe(
      "warning",
    );
  });
});

describe("chooseHost", () => {
  it("開催日を置き換え、選択を手入力の印にする", () => {
    const chosen = chooseHost(INITIAL_CHOICE, "candidate-1");

    expect(chosen.hostCandidateId).toBe("candidate-1");
    expect(chosen.source).toBe("manual");
  });

  it("予備日に入っていた候補日程を開催日にすると予備日から外す", () => {
    // 無効化するだけではチェックが入ったまま残り、同じ日程が二重に確保される
    //（ストーリー68）。
    const held: ScheduleChoice = {
      hostCandidateId: "candidate-1",
      backupCandidateIds: ["candidate-2", "candidate-3"],
      source: "ai",
    };

    expect(chooseHost(held, "candidate-2").backupCandidateIds).toEqual([
      "candidate-3",
    ]);
  });
});

describe("toggleBackup", () => {
  it("予備日を足したり外したりする", () => {
    const added = toggleBackup(INITIAL_CHOICE, "candidate-2");
    expect(added.backupCandidateIds).toEqual(["candidate-2"]);
    expect(added.source).toBe("manual");

    expect(toggleBackup(added, "candidate-2").backupCandidateIds).toEqual([]);
  });

  it("開催日を予備日にはできない", () => {
    const held: ScheduleChoice = {
      hostCandidateId: "candidate-1",
      backupCandidateIds: [],
      source: "ai",
    };

    expect(toggleBackup(held, "candidate-1")).toBe(held);
  });
});

describe("applyRecommendation", () => {
  const input = tableOf("candidate-1", "candidate-2", "candidate-3");

  it("「推奨」を開催日に、「予備に提案」を予備日に入れて報告に載せる", () => {
    const applied = applyRecommendation(
      input,
      [
        evaluationOf("candidate-1", 0.85),
        evaluationOf("candidate-2", 0.95),
        evaluationOf("candidate-3", 0.75),
      ],
      INITIAL_CHOICE,
      MEETING_INFO,
    );

    expect(applied.choice).toEqual({
      hostCandidateId: "candidate-2",
      backupCandidateIds: ["candidate-3"],
      source: "ai",
    });
    expect(applied.report.updated).toEqual([
      "評点 3件",
      "開催日 2026-10-16 13:00–14:00",
      "予備日 2026-10-17 13:00–14:00",
    ]);
    expect(applied.report.preserved).toEqual([]);
  });

  it("自分で選んだ開催日・予備日を上書きせず、守ったことを報告に載せる", () => {
    // `message` では代われない。職員から見ると「提案が届いたのに選択が変わらない」
    // ので、言わないと AI が推奨を出せなかったのか自分の選択が守られたのかが分からない。
    const held: ScheduleChoice = {
      hostCandidateId: "candidate-1",
      backupCandidateIds: [],
      source: "manual",
    };
    const applied = applyRecommendation(
      input,
      [evaluationOf("candidate-1", 0.1), evaluationOf("candidate-2", 0.95)],
      held,
      MEETING_INFO,
    );

    expect(applied.choice).toBe(held);
    expect(applied.report.preserved).toEqual(["自分で選んだ開催日と予備日"]);
  });

  it("AI が入れた選択は次の提案で上書きされる", () => {
    const held: ScheduleChoice = {
      hostCandidateId: "candidate-1",
      backupCandidateIds: [],
      source: "ai",
    };
    const applied = applyRecommendation(
      input,
      [evaluationOf("candidate-1", 0.1), evaluationOf("candidate-2", 0.95)],
      held,
      MEETING_INFO,
    );

    expect(applied.choice.hostCandidateId).toBe("candidate-2");
  });

  it("推奨も予備に提案も無ければ選択を動かさない", () => {
    // 無理に1つ選ぶと、AI が推していない候補日程に「AIが生成」の印が付く。
    const applied = applyRecommendation(
      input,
      [evaluationOf("candidate-1", 0.6), evaluationOf("candidate-2", 0.55)],
      INITIAL_CHOICE,
      MEETING_INFO,
    );

    expect(applied.choice).toBe(INITIAL_CHOICE);
    expect(applied.report.updated).toEqual(["評点 2件"]);
  });

  it("推奨が無くても予備に提案があれば予備日だけ入れる", () => {
    const applied = applyRecommendation(
      input,
      [evaluationOf("candidate-1", 0.75), evaluationOf("candidate-2", 0.55)],
      INITIAL_CHOICE,
      MEETING_INFO,
    );

    expect(applied.choice).toEqual({
      hostCandidateId: null,
      backupCandidateIds: ["candidate-1"],
      source: "ai",
    });
  });

  it("初期選択をそのまま返す（バナーの要約が同じ導出を2度しない）", () => {
    const applied = applyRecommendation(
      input,
      [evaluationOf("candidate-1", 0.9), evaluationOf("candidate-2", 0.75)],
      INITIAL_CHOICE,
      MEETING_INFO,
    );

    expect(applied.selection).toEqual({
      hostCandidateId: "candidate-1",
      backupCandidateIds: ["candidate-2"],
    });
  });
});

describe("confirmationSummary", () => {
  const input = tableOf("candidate-1", "candidate-2", "candidate-3");

  it("開催日と予備日を候補日程の並びで表示名に直す", () => {
    const summary = confirmationSummary(
      {
        hostCandidateId: "candidate-1",
        backupCandidateIds: ["candidate-3", "candidate-2"],
        source: "manual",
      },
      null,
      input.candidates,
      MEETING_INFO,
    );

    expect(summary.hostLabel).toBe("2026-10-15 13:00–14:00");
    expect(summary.backupLabels).toEqual([
      "2026-10-16 13:00–14:00",
      "2026-10-17 13:00–14:00",
    ]);
    expect(summary.differenceNote).toBeNull();
  });

  it("AI の提案と同じ選択なら違いを言わない", () => {
    const proposal = {
      hostCandidateId: "candidate-1",
      backupCandidateIds: ["candidate-2"],
    };
    const summary = confirmationSummary(
      {
        ...proposal,
        source: "ai" as const,
      },
      proposal,
      input.candidates,
      MEETING_INFO,
    );

    expect(summary.differenceNote).toBeNull();
  });

  it("AI の提案と違う選択なら AI が提案した内容を書く", () => {
    // ストーリー70。止めはしないが、違う選択をしたことを自覚してもらう。
    const summary = confirmationSummary(
      {
        hostCandidateId: "candidate-3",
        backupCandidateIds: [],
        source: "manual",
      },
      { hostCandidateId: "candidate-1", backupCandidateIds: ["candidate-2"] },
      input.candidates,
      MEETING_INFO,
    );

    expect(summary.differenceNote).toBe(
      "AI の提案（開催日: 2026-10-15 13:00–14:00 ／ 予備日: 2026-10-16 13:00–14:00）とは違う選択です。",
    );
  });

  it("予備日の並び順が違うだけなら違いとは見ない", () => {
    const summary = confirmationSummary(
      {
        hostCandidateId: "candidate-1",
        backupCandidateIds: ["candidate-3", "candidate-2"],
        source: "manual",
      },
      {
        hostCandidateId: "candidate-1",
        backupCandidateIds: ["candidate-2", "candidate-3"],
      },
      input.candidates,
      MEETING_INFO,
    );

    expect(summary.differenceNote).toBeNull();
  });

  it("開催日が未選択なら「未選択」と書く", () => {
    const summary = confirmationSummary(
      INITIAL_CHOICE,
      null,
      input.candidates,
      MEETING_INFO,
    );

    expect(summary.hostLabel).toBe("未選択");
  });
});

describe("confirmedText", () => {
  it("確定した開催日と予備日を1文で書く", () => {
    expect(
      confirmedText({
        hostLabel: "2026-10-15 13:00–14:00",
        backupLabels: ["2026-10-16 13:00–14:00"],
        differenceNote: null,
      }),
    ).toBe(
      "開催日を 2026-10-15 13:00–14:00 に確定しました。予備日: 2026-10-16 13:00–14:00",
    );
  });

  it("予備日が無ければ「なし」と書く", () => {
    expect(
      confirmedText({
        hostLabel: "2026-10-15 13:00–14:00",
        backupLabels: [],
        differenceNote: null,
      }),
    ).toBe("開催日を 2026-10-15 13:00–14:00 に確定しました。予備日: なし");
  });
});
