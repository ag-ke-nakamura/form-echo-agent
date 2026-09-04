import { describe, expect, it } from "vitest";
import { describeChange, newCandidatePreviewItems } from "./candidates-form";

/**
 * プレビューの一覧（ADR-0006、設計書 3.6.1節）。
 *
 * WHY テストを持つか: この一覧の行は「埋まらなかったかもしれない欄」ではなく AI が
 * 作った候補日程そのもので、0件だったことは行が無いことで表れる。値の欄を持たせて
 * しまうと、生成に成功した候補日程がそのまま聞き返しの対象になる（`previewTone`）。
 */
describe("newCandidatePreviewItems", () => {
  it("所要時間から導いた時間帯を添えて並べる", () => {
    expect(
      newCandidatePreviewItems(
        [
          { date: "2026-10-15", start_time: "14:00" },
          { date: "2026-10-17", start_time: "10:30" },
        ],
        60,
      ),
    ).toEqual([
      { key: "0-2026-10-15-14:00", label: "10月15日(木) 14:00–15:00" },
      { key: "1-2026-10-17-10:30", label: "10月17日(土) 10:30–11:30" },
    ]);
  });

  /* 識別子はまだ配られていないので、一意なのは並びの位置だけ。 */
  it("同じ日時が2件返っても key が衝突しない", () => {
    const items = newCandidatePreviewItems(
      [
        { date: "2026-10-15", start_time: "14:00" },
        { date: "2026-10-15", start_time: "14:00" },
      ],
      30,
    );
    expect(new Set(items.map((item) => item.key)).size).toBe(2);
  });

  it("0件なら行を持たない（聞き返しの合図になる）", () => {
    expect(newCandidatePreviewItems([], 30)).toEqual([]);
  });
});

/**
 * 作り直しで何が入れ替わったかの報告（#38）。
 *
 * WHY テストを持つか: 件数だけだと 10件が10件に変わったときに何も変わっていないのと
 * 見分けが付かない。時刻だけが動いた場合を日付の突き合わせで見ると変化を取りこぼす。
 */
describe("describeChange", () => {
  it("追加と削除を挙げる", () => {
    expect(
      describeChange(
        [{ date: "2026-10-15", start_time: "14:00" }],
        [
          { date: "2026-10-16", start_time: "14:00" },
          { date: "2026-10-17", start_time: "14:00" },
        ],
      ),
    ).toEqual(["候補日程 2件（追加 2026-10-16・2026-10-17、削除 2026-10-15）"]);
  });

  it("日付が同じで時刻だけ動いた場合も変化として言う", () => {
    expect(
      describeChange(
        [{ date: "2026-10-15", start_time: "14:00" }],
        [{ date: "2026-10-15", start_time: "16:00" }],
      ),
    ).toEqual(["候補日程 1件（時刻を変更）"]);
  });

  it("日付と時刻の組が全部同じなら何も言わない", () => {
    expect(
      describeChange(
        [{ date: "2026-10-15", start_time: "14:00" }],
        [{ date: "2026-10-15", start_time: "14:00" }],
      ),
    ).toEqual([]);
  });
});
