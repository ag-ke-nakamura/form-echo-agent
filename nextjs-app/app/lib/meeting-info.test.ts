import { describe, expect, it } from "vitest";
import {
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
