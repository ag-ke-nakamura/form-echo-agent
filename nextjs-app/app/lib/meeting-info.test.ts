import { describe, expect, it } from "vitest";
import {
  candidateEndTime,
  candidateRangeText,
  DURATION_OPTIONS,
  INITIAL_MEETING_INFO,
  MEETING_FORMAT_LABELS,
  MEETING_FORMAT_ORDER,
  meetingHeadingText,
  meetingSubInfoText,
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
