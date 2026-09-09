import { describe, expect, it } from "vitest";
import {
  hasApplicableItems,
  type PreviewItem,
  previewTone,
} from "./ai-preview";

/**
 * 聞き返しかどうかは一覧から導く（#65）。
 *
 * WHY テストを持つか: 誤ると2通りに壊れる。埋まっているのに黄色が出ると、職員は
 * 何を足せばよいのか分からないまま書き直しを促される。逆に埋まっていないのに青が
 * 出ると、**空のプレビューをそのまま反映してしまう**。どちらも「一部だけ埋まった
 * 応答」を実際に作らない限り画面には出ない。
 */
describe("previewTone", () => {
  it("全部埋まっていれば通常のメッセージ", () => {
    const items: PreviewItem[] = [
      { key: "origin", label: "出発地", value: "東京" },
      { key: "destination", label: "目的地", value: "大阪" },
    ];
    expect(previewTone(items)).toBe("filled");
  });

  it("1つでも埋まらなければ聞き返し", () => {
    const items: PreviewItem[] = [
      { key: "origin", label: "出発地", value: "東京" },
      { key: "destination", label: "目的地", value: null },
    ];
    expect(previewTone(items)).toBe("incomplete");
  });

  it("全部埋まらなければ聞き返し", () => {
    const items: PreviewItem[] = [
      { key: "origin", label: "出発地", value: null },
    ];
    expect(previewTone(items)).toBe("incomplete");
  });

  /* 候補日程タブが0件の応答をこう表す。 */
  it("1行も無ければ聞き返し", () => {
    expect(previewTone([])).toBe("incomplete");
  });

  /*
    値の欄を持たない行（候補日程）は埋まっている扱い。`null` と同じにすると、
    生成に成功した候補日程がそのまま聞き返しの対象になる。
  */
  it("値の欄を持たない行は埋まっている扱い", () => {
    const items: PreviewItem[] = [
      { key: "0", label: "10月15日(火) 14:00–15:00" },
    ];
    expect(previewTone(items)).toBe("filled");
  });

  /*
    守られる行は AI が読み取れている。聞き返しに数えると「情報を足せば進む」と
    言うことになるが、足しても入らない（手入力を守るのはそういう約束）。
  */
  it("手入力のため変わらない行は聞き返しに数えない", () => {
    const items: PreviewItem[] = [
      { key: "origin", label: "出発地", value: "東京", preserved: true },
    ];
    expect(previewTone(items)).toBe("filled");
  });
});

/**
 * 押す意味のある操作だけを出す（ADR-0006）。
 *
 * WHY テストを持つか: 誤ると2通りに壊れる。押せないのに押せると出すと、
 * 「フォームは変わっていません」と報告してアシスタントが縮むだけの操作を職員に
 * 踏ませる。逆に押せるのに押せないと出すと、**反映する手が画面から消える**。
 */
describe("hasApplicableItems", () => {
  it("埋まった行が1つでもあれば押せる", () => {
    expect(
      hasApplicableItems([
        { key: "origin", label: "出発地", value: "東京" },
        { key: "destination", label: "目的地", value: null },
      ]),
    ).toBe(true);
  });

  /* 候補日程タブの0件応答。 */
  it("1行も無ければ押せない", () => {
    expect(hasApplicableItems([])).toBe(false);
  });

  it("全部読み取れなければ押せない", () => {
    expect(
      hasApplicableItems([
        { key: "origin", label: "出発地", value: null },
        { key: "destination", label: "目的地", value: null },
      ]),
    ).toBe(false);
  });

  it("読み取れた行が全部守られていれば押せない", () => {
    expect(
      hasApplicableItems([
        { key: "origin", label: "出発地", value: "東京", preserved: true },
        { key: "destination", label: "目的地", value: null },
      ]),
    ).toBe(false);
  });

  it("値の欄を持たない行は押せる（候補日程の生成）", () => {
    expect(
      hasApplicableItems([{ key: "0", label: "10月15日(火) 14:00–15:00" }]),
    ).toBe(true);
  });
});
