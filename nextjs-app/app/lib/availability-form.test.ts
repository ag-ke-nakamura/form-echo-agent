import { AVAILABILITY_ORDER, MEETING_FORMAT_ORDER } from "@contracts/meeting";
import { describe, expect, it } from "vitest";
import type { ParseAvailabilityOutput } from "@contracts/index.js";
import {
  applyAvailabilityResult,
  type AvailabilityAnswers,
  availabilityChoicesFor,
  availabilityPreviewItems,
  candidateLabel,
  dateHeadingText,
  groupCandidatesByDate,
  normalizeAvailability,
  unjudgedCandidates,
} from "./availability-form";

const CANDIDATES = [
  { id: "candidate-1", date: "2026-10-15", start_time: "14:00" },
  { id: "candidate-2", date: "2026-10-15", start_time: "16:00" },
  { id: "candidate-3", date: "2026-10-17", start_time: "10:00" },
] as const;

/**
 * 参加形式が参加可否の選択肢を決める（`CONTEXT.md`「参加形式」）。
 *
 * WHY テストを持つか: 出し分けを間違えると、現地のみの会議で「リモートで出席」が
 * 選べたり、ハイブリッドで出席の2通りが1つに畳まれたりする。どちらも画面を描いて
 * 参加形式を切り替えない限り気付かない。
 */
describe("availabilityChoicesFor", () => {
  it("ハイブリッドでは4つ出す", () => {
    expect(availabilityChoicesFor("hybrid")).toEqual([
      { value: "attend_onsite", label: "現地で出席" },
      { value: "attend_remote", label: "リモートで出席" },
      { value: "absent", label: "欠席" },
      { value: "undecided", label: "未定" },
    ]);
  });

  it("現地のみでは3つに畳み、出席を現地に寄せる", () => {
    expect(availabilityChoicesFor("onsite")).toEqual([
      { value: "attend_onsite", label: "出席" },
      { value: "absent", label: "欠席" },
      { value: "undecided", label: "未定" },
    ]);
  });

  it("オンラインのみでは3つに畳み、出席をリモートに寄せる", () => {
    expect(availabilityChoicesFor("online")).toEqual([
      { value: "attend_remote", label: "出席" },
      { value: "absent", label: "欠席" },
      { value: "undecided", label: "未定" },
    ]);
  });

  it("どの参加形式でも欠席と未定は選べる", () => {
    // 未定は参加者が答えた結果なので、参加形式に関係なく答えられなければならない
    // （`CONTEXT.md`「未定」）。畳むのは出席の2通りだけ。
    for (const format of MEETING_FORMAT_ORDER) {
      const values = availabilityChoicesFor(format).map(
        (choice) => choice.value,
      );
      expect(values, format).toContain("absent");
      expect(values, format).toContain("undecided");
    }
  });

  it("どの参加形式でも選択肢の文言が重複しない", () => {
    // 畳んだ側で「出席」が2つ並ぶと、参加者はどちらを選んでも同じに見える。
    for (const format of MEETING_FORMAT_ORDER) {
      const labels = availabilityChoicesFor(format).map(
        (choice) => choice.label,
      );
      expect(new Set(labels).size, format).toBe(labels.length);
    }
  });
});

/**
 * AI は参加形式に関わらず4状態のどれかを返す（出力契約は参加形式を知らない）。
 * 畳んだ選択肢に無い値をそのまま入れると、**どのラジオも選ばれていない状態**に
 * なり、参加者からは AI が何も判定しなかったように見える。
 */
describe("normalizeAvailability", () => {
  it("ハイブリッドでは何も寄せない", () => {
    for (const availability of AVAILABILITY_ORDER) {
      expect(normalizeAvailability("hybrid", availability)).toBe(availability);
    }
  });

  it("現地のみではリモート出席を現地出席に寄せる", () => {
    expect(normalizeAvailability("onsite", "attend_remote")).toBe(
      "attend_onsite",
    );
  });

  it("オンラインのみでは現地出席をリモート出席に寄せる", () => {
    expect(normalizeAvailability("online", "attend_onsite")).toBe(
      "attend_remote",
    );
  });

  it("欠席と未定はどの参加形式でも動かさない", () => {
    for (const format of MEETING_FORMAT_ORDER) {
      expect(normalizeAvailability(format, "absent"), format).toBe("absent");
      expect(normalizeAvailability(format, "undecided"), format).toBe(
        "undecided",
      );
    }
  });

  it("寄せた先はその参加形式で選べる", () => {
    // 寄せた結果が選択肢に無ければ、寄せた意味が無い（ラジオは空のままになる）。
    for (const format of MEETING_FORMAT_ORDER) {
      const values = availabilityChoicesFor(format).map(
        (choice) => choice.value,
      );
      for (const availability of AVAILABILITY_ORDER) {
        expect(values, `${format} / ${availability}`).toContain(
          normalizeAvailability(format, availability),
        );
      }
    }
  });
});

/**
 * クリック単位が候補日程になった結果、同じ日に複数の候補日程が普通に発生する（#69）。
 * 日付で束ねないと、同じ日付の見出しが並んで参加者はどれがどの日か読めなくなる。
 */
describe("groupCandidatesByDate", () => {
  it("同じ日付の候補日程をひとつの組にまとめる", () => {
    expect(groupCandidatesByDate(CANDIDATES)).toEqual([
      { date: "2026-10-15", candidates: [CANDIDATES[0], CANDIDATES[1]] },
      { date: "2026-10-17", candidates: [CANDIDATES[2]] },
    ]);
  });

  it("日付の順に並べる", () => {
    // 候補日程タブは職員が足した順に並ぶので、日付が前後することがある。
    const shuffled = [CANDIDATES[2], CANDIDATES[0], CANDIDATES[1]];
    expect(groupCandidatesByDate(shuffled).map((group) => group.date)).toEqual([
      "2026-10-15",
      "2026-10-17",
    ]);
  });

  it("組の中は開始時刻の順に並べる", () => {
    const shuffled = [CANDIDATES[1], CANDIDATES[0]];
    expect(
      groupCandidatesByDate(shuffled)[0].candidates.map(
        (candidate) => candidate.start_time,
      ),
    ).toEqual(["14:00", "16:00"]);
  });

  it("候補日程が無ければ組も無い", () => {
    expect(groupCandidatesByDate([])).toEqual([]);
  });
});

describe("dateHeadingText", () => {
  it("設計書 4.6.1節の書式で出す", () => {
    expect(dateHeadingText("2026-10-15")).toBe("10月15日(木)");
  });

  it("月と日の先頭の0を落とす", () => {
    expect(dateHeadingText("2026-01-05")).toBe("1月5日(月)");
  });

  it("日付の形になっていなければそのまま返す", () => {
    // 候補日程の日付は出力契約が YYYY-MM-DD を保証するが、手入力の途中の値が
    // ここへ来ることがある。整形できないことを見出しから隠さない。
    expect(dateHeadingText("")).toBe("");
    expect(dateHeadingText("2026-13-45")).toBe("2026-13-45");
  });
});

describe("candidateLabel", () => {
  it("日付と時間帯を並べる", () => {
    expect(candidateLabel(CANDIDATES[0], 60)).toBe("10月15日(木) 14:00–15:00");
  });
});

/**
 * 判定できなかった候補日程は出力契約では**要素の不在**でしか表れない。引き算の条件を
 * 間違えると、言い直しのたびに全件を訊くか、聞き返しが1件も出ないかのどちらかになる。
 */
describe("unjudgedCandidates", () => {
  it("直近の応答が判定しなかった候補日程を挙げる", () => {
    expect(unjudgedCandidates(CANDIDATES, ["candidate-1"], [])).toEqual([
      CANDIDATES[1],
      CANDIDATES[2],
    ]);
  });

  it("既に回答のある候補日程は挙げない", () => {
    // 前の往復で AI が判定した分や参加者が手で選んだ分は、今回の応答に載っていなくても
    // 答えは画面にある。載せると言い直しのたびに全件を訊くことになる。
    expect(
      unjudgedCandidates(
        CANDIDATES,
        ["candidate-1"],
        ["candidate-1", "candidate-2"],
      ),
    ).toEqual([CANDIDATES[2]]);
  });

  it("全部judgedなら空になる", () => {
    expect(
      unjudgedCandidates(
        CANDIDATES,
        ["candidate-1", "candidate-2", "candidate-3"],
        [],
      ),
    ).toEqual([]);
  });

  it("候補日程に無い識別子は無視する", () => {
    // 応答を待つ間に職員が候補日程を消していることはありうる。
    expect(unjudgedCandidates([], ["candidate-1"], [])).toEqual([]);
  });
});

/**
 * 反映の規則3つ（手で選んだ参加可否は上書きしない・手で書いた備考は消さない・畳んだ
 * 選択肢に無い値は寄せる）。**どれも往復を繰り返さない限り画面では確かめられない。**
 */
describe("applyAvailabilityResult", () => {
  const HYBRID = {
    candidates: CANDIDATES,
    format: "hybrid",
    durationMinutes: 60,
  } as const;

  function output(
    availability: ParseAvailabilityOutput["availability"],
  ): ParseAvailabilityOutput {
    return { availability, message: "読み取りました。", sources: [] };
  }

  it("AI の判定と備考をそのまま写す", () => {
    const applied = applyAvailabilityResult(
      {},
      output([
        {
          candidate_id: "candidate-1",
          availability: "attend_onsite",
          note: "午前中は別の予定あり",
        },
      ]),
      HYBRID,
    );

    expect(applied.answers["candidate-1"]).toEqual({
      availability: "attend_onsite",
      source: "ai",
      note: "午前中は別の予定あり",
      noteSource: "ai",
    });
    expect(applied.judgedCandidateIds).toEqual(["candidate-1"]);
    expect(applied.report.updated).toEqual(["10月15日(木) 14:00–15:00"]);
  });

  it("備考が無ければ空文字にする", () => {
    const applied = applyAvailabilityResult(
      {},
      output([
        { candidate_id: "candidate-1", availability: "absent", note: null },
      ]),
      HYBRID,
    );

    expect(applied.answers["candidate-1"].note).toBe("");
  });

  it("手で選んだ参加可否は上書きしない", () => {
    const answers: AvailabilityAnswers = {
      "candidate-1": {
        availability: "absent",
        source: "manual",
        note: "",
        noteSource: "manual",
      },
    };

    const applied = applyAvailabilityResult(
      answers,
      output([
        {
          candidate_id: "candidate-1",
          availability: "attend_onsite",
          note: null,
        },
      ]),
      HYBRID,
    );

    expect(applied.answers["candidate-1"].availability).toBe("absent");
    expect(applied.report.updated).toEqual([]);
    expect(applied.report.preserved).toEqual(["10月15日(木) 14:00–15:00"]);
  });

  it("手で書いた備考は次の応答で消えない", () => {
    // 印（バッジ）は参加可否の側にしか無いので、備考の出どころを別に持たないと
    // ここが保護から漏れて、参加者の書いた事情が黙って消える。
    const answers: AvailabilityAnswers = {
      "candidate-1": {
        availability: "attend_onsite",
        source: "ai",
        note: "16時までに退出します",
        noteSource: "manual",
      },
    };

    const applied = applyAvailabilityResult(
      answers,
      output([
        { candidate_id: "candidate-1", availability: "absent", note: null },
      ]),
      HYBRID,
    );

    expect(applied.answers["candidate-1"]).toEqual({
      availability: "absent",
      source: "ai",
      note: "16時までに退出します",
      noteSource: "manual",
    });
    expect(applied.report.updated).toEqual([
      "10月15日(木) 14:00–15:00（備考は保持）",
    ]);
  });

  it("AI が入れた備考は次の応答で書き換わる", () => {
    const answers: AvailabilityAnswers = {
      "candidate-1": {
        availability: "attend_onsite",
        source: "ai",
        note: "午前中は別の予定あり",
        noteSource: "ai",
      },
    };

    const applied = applyAvailabilityResult(
      answers,
      output([
        { candidate_id: "candidate-1", availability: "absent", note: null },
      ]),
      HYBRID,
    );

    expect(applied.answers["candidate-1"].note).toBe("");
  });

  it("畳んだ選択肢に無い値は参加形式へ寄せる", () => {
    const applied = applyAvailabilityResult(
      {},
      output([
        {
          candidate_id: "candidate-1",
          availability: "attend_remote",
          note: null,
        },
      ]),
      { ...HYBRID, format: "onsite" },
    );

    expect(applied.answers["candidate-1"].availability).toBe("attend_onsite");
  });

  it("当てる先が消えていた分を報告に載せる", () => {
    // 応答を待つ間に職員が候補日程を消していることはありうる。黙って落とすと、
    // 指示が届かなかったのと見分けが付かない。
    const applied = applyAvailabilityResult(
      {},
      output([
        {
          candidate_id: "candidate-9",
          availability: "attend_onsite",
          note: null,
        },
      ]),
      HYBRID,
    );

    expect(applied.answers).toEqual({});
    expect(applied.report.dropped).toEqual(["candidate-9"]);
    expect(applied.judgedCandidateIds).toEqual([]);
  });

  it("応答に無い候補日程の回答は残る", () => {
    // 「すみません、15日は欠席でした」のような言い直しで、他の候補日程の判定が
    // 消えないこと（#70 の受け入れ条件）。
    const answers: AvailabilityAnswers = {
      "candidate-2": {
        availability: "attend_remote",
        source: "ai",
        note: "",
        noteSource: "ai",
      },
    };

    const applied = applyAvailabilityResult(
      answers,
      output([
        { candidate_id: "candidate-1", availability: "absent", note: null },
      ]),
      HYBRID,
    );

    expect(applied.answers["candidate-2"].availability).toBe("attend_remote");
  });
});

/**
 * プレビューの一覧（ADR-0006、設計書 4.6.1節）。
 *
 * WHY テストを持つか: 並べるのは応答ではなく画面の候補日程で、判定できなかった分は
 * 出力契約では要素の不在でしか表れない。応答だけを並べると「答えなかった」が一覧から
 * 消え、聞き返しの判断も全部埋まったと読む。参加形式への寄せがラジオの文言と食い違うと、
 * 押す前に見た語と押した後にラジオへ入る値が違って見える。
 */
describe("availabilityPreviewItems", () => {
  function output(
    availability: ParseAvailabilityOutput["availability"],
  ): ParseAvailabilityOutput {
    return { availability, message: "", sources: [] };
  }

  it("画面の候補日程を全部並べ、判定できなかった分は値を持たない", () => {
    const items = availabilityPreviewItems(
      {},
      output([
        {
          candidate_id: "candidate-1",
          availability: "attend_onsite",
          note: null,
        },
        { candidate_id: "candidate-3", availability: "absent", note: null },
      ]),
      { candidates: CANDIDATES, format: "hybrid", durationMinutes: 60 },
    );
    expect(items).toEqual([
      {
        key: "candidate-1",
        label: "10月15日(木) 14:00–15:00",
        value: "現地で出席",
      },
      { key: "candidate-2", label: "10月15日(木) 16:00–17:00", value: null },
      {
        key: "candidate-3",
        label: "10月17日(土) 10:00–11:00",
        value: "欠席",
      },
    ]);
  });

  it("参加形式で畳まれる文言はラジオと同じ語を出す", () => {
    const items = availabilityPreviewItems(
      {},
      output([
        {
          candidate_id: "candidate-1",
          availability: "attend_remote",
          note: null,
        },
      ]),
      { candidates: CANDIDATES, format: "onsite", durationMinutes: 60 },
    );
    // 現地のみの会議なので `attend_onsite` へ寄り、文言も「出席」に畳まれる。
    expect(items[0].value).toBe("出席");
  });

  it("備考も一緒に出す（反映すると備考欄まで書き換わるため）", () => {
    const items = availabilityPreviewItems(
      {},
      output([
        {
          candidate_id: "candidate-1",
          availability: "attend_remote",
          note: "午前中は別の予定があります",
        },
      ]),
      { candidates: CANDIDATES, format: "hybrid", durationMinutes: 60 },
    );
    expect(items[0].value).toBe(
      "リモートで出席（備考: 午前中は別の予定があります）",
    );
  });

  /*
    プレビューが「押したら入る」と偽らないことの検査（ADR-0006）。判定は
    `applyAvailabilityResult` と同じ条件（手で選んだ可否は守る）を見ている。
  */
  it("手で選んだ候補日程は、判定されていても変わらない印を付ける", () => {
    const answers: AvailabilityAnswers = {
      "candidate-1": {
        availability: "absent",
        source: "manual",
        note: "",
        noteSource: "manual",
      },
    };
    const result = output([
      {
        candidate_id: "candidate-1",
        availability: "attend_onsite",
        note: null,
      },
    ]);
    const items = availabilityPreviewItems(answers, result, {
      candidates: CANDIDATES,
      format: "hybrid",
      durationMinutes: 60,
    });
    expect(items[0]).toEqual({
      key: "candidate-1",
      label: "10月15日(木) 14:00–15:00",
      value: "現地で出席",
      preserved: true,
    });
    // 実際に反映しても変わらない。
    const applied = applyAvailabilityResult(answers, result, {
      candidates: CANDIDATES,
      format: "hybrid",
      durationMinutes: 60,
    });
    expect(applied.answers["candidate-1"].availability).toBe("absent");
  });

  it("手で書いた備考は守られるので、AI の備考を見せない", () => {
    const answers: AvailabilityAnswers = {
      "candidate-1": {
        availability: "undecided",
        source: "ai",
        note: "本人が書いた事情",
        noteSource: "manual",
      },
    };
    const items = availabilityPreviewItems(
      answers,
      output([
        {
          candidate_id: "candidate-1",
          availability: "attend_onsite",
          note: "AI が書いた備考",
        },
      ]),
      { candidates: CANDIDATES, format: "hybrid", durationMinutes: 60 },
    );
    expect(items[0].value).toBe("現地で出席（備考は保持）");
  });

  /* 応答に載っていても画面から消えている候補日程は行を起こす先が無い。 */
  it("画面に無い候補日程は一覧に出さない", () => {
    const items = availabilityPreviewItems(
      {},
      output([
        { candidate_id: "candidate-9", availability: "absent", note: null },
      ]),
      { candidates: CANDIDATES, format: "hybrid", durationMinutes: 60 },
    );
    expect(items.map((item) => item.key)).toEqual([
      "candidate-1",
      "candidate-2",
      "candidate-3",
    ]);
    expect(items.every((item) => item.value === null)).toBe(true);
  });
});
