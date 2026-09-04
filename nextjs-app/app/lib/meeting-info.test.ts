import {
  AVAILABILITY_ORDER,
  DURATION_OPTIONS,
  MEETING_FORMAT_ORDER,
} from "@contracts/meeting";
import { describe, expect, it } from "vitest";
import {
  AVAILABILITY_LABELS,
  candidateEndTime,
  candidateLabel,
  candidateRangeText,
  dateHeadingText,
  INITIAL_MEETING_INFO,
  MEETING_FORMAT_LABELS,
  meetingHeadingText,
  meetingSubInfoText,
  weekdayOf,
} from "./meeting-info";

/**
 * 会議情報の表示文字列（#66 のシーム）。
 *
 * WHY テストを持つか: この2つの文字列はタブ2で入れたものがタブ3にどう出るかの
 * 取り決めそのもので、設計書 3節が書式まで決めている。JSX の中に埋め込んだままだと、
 * 区切りを ` / ` に変えても「分」を落としても、誰も動かして見ない限り気付かない。
 */
describe("MEETING_FORMAT_LABELS", () => {
  it("参加形式を用語集の語で呼ぶ", () => {
    // 設計書 3.2節は `オンライン` と書くが、用語集（CONTEXT.md）は
    // 「オンラインのみ」を正としている。タブ2の選択肢と同じ語で呼ぶ。
    expect(MEETING_FORMAT_LABELS).toEqual({
      hybrid: "ハイブリッド",
      onsite: "現地のみ",
      online: "オンラインのみ",
    });
  });
});

describe("AVAILABILITY_LABELS", () => {
  it("4状態すべてに表示名がある", () => {
    // 記号（○×）に畳まない。2記号では現地とリモート、欠席と未定を区別できない。
    expect(AVAILABILITY_LABELS).toEqual({
      attend_onsite: "現地",
      attend_remote: "リモート",
      absent: "欠席",
      undecided: "未定",
    });
  });

  it("どの値も別の語で呼ばれる", () => {
    const labels = AVAILABILITY_ORDER.map(
      (availability) => AVAILABILITY_LABELS[availability],
    );
    expect(new Set(labels).size).toBe(AVAILABILITY_ORDER.length);
  });
});

describe("meetingSubInfoText", () => {
  it("設計書 3.2節の書式で出す", () => {
    expect(
      meetingSubInfoText({
        name: "定例会議",
        durationMinutes: 60,
        format: "hybrid",
      }),
    ).toBe("開催時間: 60分 | 参加形式: ハイブリッド");
  });

  it("どの参加形式でも表示名が空にならない", () => {
    for (const format of MEETING_FORMAT_ORDER) {
      expect(
        meetingSubInfoText({ ...INITIAL_MEETING_INFO, format }),
        format,
      ).toContain(MEETING_FORMAT_LABELS[format]);
    }
  });
});

describe("meetingHeadingText", () => {
  it("会議名をそのまま見出しにする", () => {
    expect(
      meetingHeadingText({ ...INITIAL_MEETING_INFO, name: "定例会議" }),
    ).toBe("定例会議");
  });

  it("会議名が無いときも見出しを空にしない", () => {
    // 空白にすると「この画面には会議情報が無い」と読めてしまい、タブ2で入れれば
    // 埋まることが画面から分からなくなる。
    for (const name of ["", "   "]) {
      expect(
        meetingHeadingText({ ...INITIAL_MEETING_INFO, name }),
        JSON.stringify(name),
      ).toBe("（会議名未入力）");
    }
  });
});

describe("INITIAL_MEETING_INFO", () => {
  it("既定はハイブリッドの30分", () => {
    // 参加形式の既定は #66、所要時間の既定は設計書 5節
    // 「所要時間未設定時はデフォルト30分枠」。
    expect(INITIAL_MEETING_INFO.format).toBe("hybrid");
    expect(INITIAL_MEETING_INFO.durationMinutes).toBe(30);
    expect(INITIAL_MEETING_INFO.name).toBe("");
  });
});

/**
 * 候補日程が終了時刻を持たなくなった（ADR-0005）ので、終わる時刻はここでしか
 * 出てこない。導出を間違えると、画面に出る時間帯だけが所要時間と食い違う。
 */
describe("candidateEndTime", () => {
  it("開始時刻に所要時間を足す", () => {
    expect(candidateEndTime("13:00", 60)).toBe("14:00");
    expect(candidateEndTime("13:30", 30)).toBe("14:00");
    expect(candidateEndTime("09:15", 120)).toBe("11:15");
  });

  it("ちょうど24時に終わる候補日程は成立する", () => {
    expect(candidateEndTime("23:00", 60)).toBe("00:00");
  });

  it("日をまたぐ候補日程は成立しない", () => {
    // 丸めて 23:59 を返すと、画面には収まっているように見えるのに所要時間ぶんの
    // 時間が取れていない候補日程が出る。
    expect(candidateEndTime("23:30", 60)).toBeNull();
  });

  it("時刻の形になっていなければ導けない", () => {
    expect(candidateEndTime("", 60)).toBeNull();
    expect(candidateEndTime("午後1時", 60)).toBeNull();
  });

  it("どの所要時間でも 09:00 開始は同じ日に収まる", () => {
    for (const minutes of DURATION_OPTIONS) {
      expect(candidateEndTime("09:00", minutes), `${minutes}分`).not.toBeNull();
    }
  });
});

describe("candidateRangeText", () => {
  it("開始と終了を並べる", () => {
    expect(candidateRangeText("13:00", 90)).toBe("13:00–14:30");
  });

  it("終わる時刻が出せないときは開始時刻だけを出す", () => {
    // 「〜」の右が空のまま並ぶと、読み取り漏れなのか日をまたいだのかが読めない。
    expect(candidateRangeText("23:30", 60)).toBe("23:30");
  });
});

/**
 * 曜日（日付見出しと、カレンダーの列見出しが引く）。
 *
 * WHY テストを持つか: `Intl` を使えない（SSG なのでビルド環境とブラウザでロケールが
 * 違う）ので、曜日は自分で数える。数え方を間違えると、日付見出しとカレンダーの列が
 * 揃って1日ずれる — 揃ってずれるので画面を並べても気付けない。
 */
describe("weekdayOf", () => {
  it("曜日を返す", () => {
    expect(weekdayOf("2026-09-08")).toBe("火");
    expect(weekdayOf("2026-09-13")).toBe("日");
  });

  it("暦に無い日付と桁揃えの緩い日付は null", () => {
    expect(weekdayOf("2026-02-30")).toBeNull();
    expect(weekdayOf("2026-9-8")).toBeNull();
  });
});

/**
 * 候補日程の表示文字列（#70 のシーム。#69 でここへ移した）。
 *
 * WHY ここにあるか: 日付見出しは参加可否タブが、候補日程の表示名は3タブの `app/lib` が
 * 引く。タブ3のモジュールに置いたままだと、候補日程タブがそこから掘りに行くことになる。
 */
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
    expect(
      candidateLabel({ date: "2026-10-15", start_time: "14:00" }, 60),
    ).toBe("10月15日(木) 14:00–15:00");
  });
});
