import { MAX_INPUT_CANDIDATES } from "@contracts/meeting";
import { describe, expect, it } from "vitest";
import {
  addCandidateAt,
  candidateConflicts,
  candidateSlots,
  dayColumnHeading,
  type CalendarCandidate,
  calendarDays,
  isoDateOf,
  offGridCandidates,
  slotLabel,
  slotKey,
  SLOT_START_TIMES,
} from "./candidate-calendar";

/**
 * 2週間カレンダーの日付列（設計書 2.1節）。
 *
 * WHY テストを持つか: 週送りナビゲーションが無い（#64 Out of Scope）ので、この14日が
 * 職員がクリックで選べる範囲そのものになる。月をまたぐ足し算を間違えると、存在しない
 * 日付の列が出るか、同じ日が2列出るかのどちらかになる。
 */
describe("calendarDays", () => {
  it("起点から14日ぶんを並べる", () => {
    expect(calendarDays("2026-09-04")).toEqual([
      "2026-09-04",
      "2026-09-05",
      "2026-09-06",
      "2026-09-07",
      "2026-09-08",
      "2026-09-09",
      "2026-09-10",
      "2026-09-11",
      "2026-09-12",
      "2026-09-13",
      "2026-09-14",
      "2026-09-15",
      "2026-09-16",
      "2026-09-17",
    ]);
  });

  it("月をまたぐ", () => {
    const days = calendarDays("2026-09-25");
    expect(days[6]).toBe("2026-10-01");
    expect(days.at(-1)).toBe("2026-10-08");
  });
});

/**
 * 時間軸の升目（設計書 2.1節の 9:00 から30分刻み）。
 *
 * WHY テストを持つか: 升目は**候補日程が始まれる位置**でもある。18:00 の行を作ると、
 * どんな所要時間でも業務時間内に収まらない位置が並ぶことになる。
 */
describe("SLOT_START_TIMES", () => {
  it("9:00 から17:30 までの30分刻み", () => {
    expect(SLOT_START_TIMES.length).toBe(18);
    expect(SLOT_START_TIMES[0]).toBe("09:00");
    expect(SLOT_START_TIMES[1]).toBe("09:30");
    expect(SLOT_START_TIMES.at(-1)).toBe("17:30");
  });
});

/**
 * クリックから候補日程を作る（#69 の受け入れ条件）。
 *
 * WHY テストを持つか: **クリック単位は候補日程であってスロットではない。** 1クリックが
 * 所要時間ぶんの連続したスロットを占めるという取り決めは、重なりの判定と業務時間への
 * 収まりを通してしか外から見えない。画面に置くと、所要時間を変えながら何度もクリック
 * しない限り確かめられない。
 */
describe("addCandidateAt", () => {
  it("1クリックが候補日程1件になる", () => {
    expect(
      addCandidateAt(
        [],
        { date: "2026-09-08", start_time: "14:00" },
        60,
        "candidate-0",
      ),
    ).toEqual({
      candidates: [
        {
          id: "candidate-0",
          date: "2026-09-08",
          start_time: "14:00",
          source: "manual",
        },
      ],
      rejected: null,
    });
  });

  it("所要時間ぶんの範囲に重なるクリックを受け付けない", () => {
    const existing: CalendarCandidate[] = [
      {
        id: "candidate-0",
        date: "2026-09-08",
        start_time: "14:00",
        source: "manual",
      },
    ];

    const overlapping = addCandidateAt(
      existing,
      { date: "2026-09-08", start_time: "14:30" },
      60,
      "candidate-1",
    );
    expect(overlapping.candidates).toEqual(existing);
    expect(overlapping.rejected).toBe(
      "既に選んだ候補日程（9月8日(火) 14:00–15:00）と重なります。所要時間ぶんの範囲は1件で埋まります。",
    );

    // 所要時間ぶんが終わった直後は空いている。
    expect(
      addCandidateAt(
        existing,
        { date: "2026-09-08", start_time: "15:00" },
        60,
        "candidate-1",
      ).rejected,
    ).toBeNull();

    // 同じ時刻でも日付が違えば重ならない。
    expect(
      addCandidateAt(
        existing,
        { date: "2026-09-09", start_time: "14:30" },
        60,
        "candidate-1",
      ).rejected,
    ).toBeNull();
  });

  it("所要時間ぶんが業務時間内に収まらないクリックを受け付けない", () => {
    const slot = { date: "2026-09-08", start_time: "17:30" };
    expect(addCandidateAt([], slot, 60, "candidate-0").rejected).toBe(
      "所要時間60分が18:00までに収まりません。",
    );
    expect(addCandidateAt([], slot, 30, "candidate-0").rejected).toBeNull();
    expect(
      addCandidateAt(
        [],
        { date: "2026-09-08", start_time: "17:00" },
        60,
        "candidate-0",
      ).rejected,
    ).toBeNull();
  });

  /* 上限は入力契約が持つ（`contracts/meeting.ts`）。文言は `candidate-limit.ts` に1箇所。 */
  it("入力契約の上限を超えるクリックを受け付けない", () => {
    const full: CalendarCandidate[] = Array.from(
      { length: MAX_INPUT_CANDIDATES },
      (_, index) => ({
        id: `candidate-${index}`,
        date: `2026-09-${String(8 + Math.floor(index / 2)).padStart(2, "0")}`,
        start_time: index % 2 === 0 ? "09:00" : "11:00",
        source: "manual",
      }),
    );

    const result = addCandidateAt(
      full,
      { date: "2026-09-08", start_time: "13:00" },
      30,
      "candidate-99",
    );
    expect(result.candidates).toEqual(full);
    expect(result.rejected).toBe(
      "候補日程は30件までです。減らすと AI に渡せます。",
    );
  });
});

/**
 * 候補日程からスロットの被覆を導く（設計書 5.5節の逆向き）。
 *
 * WHY テストを持つか: **候補日程は終了時刻を持たない**（ADR-0005）ので、どの升目が
 * 塗られるかは所要時間からその場で導くしかない。導出を間違えると、所要時間を変えても
 * 升目の塗りだけが古い長さのまま残る（#69 の受け入れ条件「所要時間を変えると既存の
 * 候補日程が伸縮する」がまさにここ）。
 */
describe("candidateSlots", () => {
  it("所要時間ぶんの連続した升目を1件の候補日程で埋める", () => {
    const slots = candidateSlots(
      [
        {
          id: "candidate-0",
          date: "2026-09-08",
          start_time: "14:00",
          source: "ai",
        },
      ],
      60,
    );

    expect(
      slots.get(slotKey({ date: "2026-09-08", start_time: "14:00" })),
    ).toEqual({
      candidateId: "candidate-0",
      source: "ai",
      isStart: true,
      isEnd: false,
    });
    expect(
      slots.get(slotKey({ date: "2026-09-08", start_time: "14:30" })),
    ).toEqual({
      candidateId: "candidate-0",
      source: "ai",
      isStart: false,
      isEnd: true,
    });
    // 30分刻みの升目が2つで所要時間ぶん。3つ目は空いている。
    expect(
      slots.get(slotKey({ date: "2026-09-08", start_time: "15:00" })),
    ).toBeUndefined();
    expect(slots.size).toBe(2);
  });

  it("業務時間の外へはみ出した分は升目を持たない", () => {
    const slots = candidateSlots(
      [
        {
          id: "candidate-0",
          date: "2026-09-08",
          start_time: "17:30",
          source: "manual",
        },
      ],
      60,
    );

    expect(slots.size).toBe(1);
    expect(
      slots.get(slotKey({ date: "2026-09-08", start_time: "17:30" }))?.isEnd,
    ).toBe(true);
  });
});

/**
 * 所要時間を伸ばした後に起こる不整合（#69 の設計判断）。
 *
 * WHY 消さずに数えるか: 伸縮は導出なので、所要時間を長くすると職員が選んだ候補日程が
 * 互いに重なるか業務時間を越える。自動で解除すると職員が選んだものが操作なしで消える
 * ので、残して注意に出す。**クリックでは作れない状態が画面に残る**ことを黙認しない
 * ための数え上げがこれである。
 */
describe("candidateConflicts", () => {
  const pair: CalendarCandidate[] = [
    {
      id: "candidate-0",
      date: "2026-09-08",
      start_time: "14:00",
      source: "manual",
    },
    {
      id: "candidate-1",
      date: "2026-09-08",
      start_time: "14:30",
      source: "ai",
    },
  ];

  const days = calendarDays("2026-09-04");

  it("30分では重ならない2件が60分では重なる", () => {
    expect(candidateConflicts(pair, 30, days)).toEqual([]);
    expect(candidateConflicts(pair, 60, days)).toEqual([
      { candidate: pair[0], conflict: "overlap" },
      { candidate: pair[1], conflict: "overlap" },
    ]);
  });

  it("業務時間を越える候補日程を挙げる", () => {
    const late: CalendarCandidate[] = [
      {
        id: "candidate-0",
        date: "2026-09-08",
        start_time: "17:30",
        source: "manual",
      },
    ];
    expect(candidateConflicts(late, 30, days)).toEqual([]);
    expect(candidateConflicts(late, 60, days)).toEqual([
      { candidate: late[0], conflict: "after_hours" },
    ]);
  });

  /*
    升目に載らない候補日程はここに出さない。出すと `offGridCandidates` の一覧と
    二重に並び、しかも「升目を押して解除」という直し方がその候補日程には無い。
  */
  it("カレンダーに描けない候補日程は挙げない", () => {
    const offGrid: CalendarCandidate[] = [
      {
        id: "candidate-0",
        date: "2026-09-08",
        start_time: "19:00",
        source: "ai",
      },
    ];
    expect(candidateConflicts(offGrid, 60, days)).toEqual([]);
  });

  /* 相手が描けない候補日程でも、描ける側の重なりは挙げる（状態は実際に重なっている）。 */
  it("描けない候補日程と重なる升目は挙げる", () => {
    const mixed: CalendarCandidate[] = [
      {
        id: "candidate-0",
        date: "2026-09-08",
        start_time: "14:15",
        source: "ai",
      },
      {
        id: "candidate-1",
        date: "2026-09-08",
        start_time: "14:30",
        source: "manual",
      },
    ];
    expect(candidateConflicts(mixed, 30, days)).toEqual([
      { candidate: mixed[1], conflict: "overlap" },
    ]);
  });
});

/* 重なった升目の持ち主は解除の宛先になる（`candidateSlots` の取り決め）。 */
describe("candidateSlots の重なり", () => {
  it("後から始まる候補日程が升目を取る", () => {
    const slots = candidateSlots(
      [
        {
          id: "candidate-0",
          date: "2026-09-08",
          start_time: "14:00",
          source: "manual",
        },
        {
          id: "candidate-1",
          date: "2026-09-08",
          start_time: "14:30",
          source: "manual",
        },
      ],
      60,
    );

    expect(
      slots.get(slotKey({ date: "2026-09-08", start_time: "14:00" }))
        ?.candidateId,
    ).toBe("candidate-0");
    expect(
      slots.get(slotKey({ date: "2026-09-08", start_time: "14:30" })),
    ).toMatchObject({
      candidateId: "candidate-1",
      isStart: true,
    });
  });
});

/**
 * カレンダーに描けない候補日程（#69 の設計判断）。
 *
 * WHY 挙げるか: AI は「来月の午後」と言われれば2週間の外の日付を返し、時刻も升目の
 * 刻みから外れうる（14:15）。週送りナビゲーションは無い（#64 Out of Scope）ので、
 * グリッドに描けない候補日程は**画面のどこにも出ないまま件数だけが増える。** 反映が
 * 加算であることと、選択済み件数が信じられることを両立させるには、描けないものを
 * 一覧で出して解除もできるようにするしかない。
 */
describe("offGridCandidates", () => {
  const days = calendarDays("2026-09-04");

  it("表示範囲の外と升目に載らない時刻を挙げる", () => {
    const candidates: CalendarCandidate[] = [
      {
        id: "candidate-0",
        date: "2026-09-08",
        start_time: "14:00",
        source: "ai",
      },
      // 2週間の外（「来月の午後」で普通に起こる）。
      {
        id: "candidate-1",
        date: "2026-10-15",
        start_time: "14:00",
        source: "ai",
      },
      // 業務時間の外。
      {
        id: "candidate-2",
        date: "2026-09-08",
        start_time: "08:00",
        source: "ai",
      },
      // 30分の刻みに載らない。
      {
        id: "candidate-3",
        date: "2026-09-08",
        start_time: "14:15",
        source: "ai",
      },
    ];

    expect(offGridCandidates(candidates, days).map((c) => c.id)).toEqual([
      "candidate-1",
      "candidate-2",
      "candidate-3",
    ]);
  });
});

/**
 * カレンダーの列見出し（設計書 2.1節）。
 *
 * WHY 短い書式を別に持つか: 14列を横に並べるので、参加可否タブの `M月D日(曜)` では
 * 列幅に収まらない。曜日そのものは `meeting-info.ts` の1箇所から引く。
 */
describe("dayColumnHeading", () => {
  it("M/D(曜) で出す", () => {
    expect(dayColumnHeading("2026-09-08")).toBe("9/8(火)");
  });

  it("読めない日付はそのまま返す", () => {
    expect(dayColumnHeading("2026-02-30")).toBe("2026-02-30");
  });
});

/**
 * 起点の日付（設計書 2.1節。カレンダーは職員が見ている「今日」から2週間）。
 *
 * WHY 時計を読む側と分けるか: SSG なのでビルド時に描いた HTML とブラウザの初回描画が
 * 食い違ってはいけない（起点はマウント後に決める）。決め方そのものは値で閉じるので、
 * 現地時刻の日付を取り違えていないかはここで確かめる — UTC で取ると、日本時間の
 * 早朝に開いた職員のカレンダーが前日から始まる。
 */
describe("isoDateOf", () => {
  it("現地時刻の日付を返す", () => {
    // 日本時間の 2026-09-08 07:30（UTC では前日の 22:30）。
    expect(isoDateOf(new Date("2026-09-07T22:30:00Z"), 9 * 60)).toBe(
      "2026-09-08",
    );
  });
});

/**
 * 升目の読み上げ文（設計書 8.3節「AI選択スロットはボーダーだけでなく aria-label でも
 * 判別可能」）。
 *
 * WHY テストを持つか: 緑のボーダー（設計書 5.2節の案B）を採ったので、AI が選んだ
 * ことは**色でしか出ていない。** 読み上げの側に語が無いと、案Bを選んだ理由
 * （アクセシビリティ）が成り立たない。
 */
describe("slotLabel", () => {
  it("日付と時刻を読み上げる", () => {
    expect(
      slotLabel({ date: "2026-09-08", start_time: "14:00" }, undefined),
    ).toBe("9/8(火) 14:00");
  });

  it("AI が選んだ升目はそう言う", () => {
    expect(
      slotLabel(
        { date: "2026-09-08", start_time: "14:00" },
        {
          candidateId: "candidate-0",
          source: "ai",
          isStart: true,
          isEnd: true,
        },
      ),
    ).toBe("9/8(火) 14:00 AIが選択");
  });
});
