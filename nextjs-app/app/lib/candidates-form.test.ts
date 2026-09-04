import { describe, expect, it } from "vitest";
import type { CalendarCandidate } from "./candidate-calendar";
import { applyAiCandidates, newCandidatePreviewItems } from "./candidates-form";

const MANUAL: CalendarCandidate = {
  id: "candidate-0",
  date: "2026-09-08",
  start_time: "14:00",
  source: "manual",
};

/**
 * AI の結果をカレンダーへ反映する（設計書 5.1節、#69 の受け入れ条件）。
 *
 * WHY テストを持つか: **反映は加算**で、手で選んだ候補日程を潰さない。潰さないことを
 * 画面で確かめるには、手で選んでから AI に重なる候補日程を返させる往復が要る。
 * 見送った分の報告も同じで、応答を作り分けないと出てこない。
 */
describe("applyAiCandidates", () => {
  it("加算する。手で選んだ候補日程は残る", () => {
    const applied = applyAiCandidates(
      [MANUAL],
      {
        candidates: [
          { date: "2026-09-09", start_time: "10:00" },
          { date: "2026-09-10", start_time: "10:00" },
        ],
        message: "候補日程を2件生成しました。",
        sources: [],
      },
      60,
      1,
    );

    expect(applied.candidates).toEqual([
      MANUAL,
      {
        id: "candidate-1",
        date: "2026-09-09",
        start_time: "10:00",
        source: "ai",
      },
      {
        id: "candidate-2",
        date: "2026-09-10",
        start_time: "10:00",
        source: "ai",
      },
    ]);
    expect(applied.report).toEqual({
      updated: ["9月9日(水) 10:00–11:00", "9月10日(木) 10:00–11:00"],
      preserved: ["手で選んだ候補日程 1件"],
      skipped: [],
    });
  });

  it("既に選んだ候補日程と重なる分を見送り、報告に載せる", () => {
    const applied = applyAiCandidates(
      [MANUAL],
      {
        candidates: [
          // 手で選んだ 14:00–15:00 に重なる。
          { date: "2026-09-08", start_time: "14:30" },
          { date: "2026-09-08", start_time: "16:00" },
        ],
        message: "候補日程を2件生成しました。",
        sources: [],
      },
      60,
      1,
    );

    // 見送った1件目で番号を飛ばさないので、2件目が candidate-1 になる。
    expect(applied.candidates.map((candidate) => candidate.id)).toEqual([
      "candidate-0",
      "candidate-1",
    ]);
    expect(applied.report.updated).toEqual(["9月8日(火) 16:00–17:00"]);
    expect(applied.report.skipped).toEqual([
      "9月8日(火) 14:30–15:30（既に選んだ候補日程と重なります）",
    ]);
  });

  /* 同じ応答の中で重なることもある（先に入れた分が次の判定の相手になる）。 */
  it("同じ応答の中で重なる候補日程も見送る", () => {
    const applied = applyAiCandidates(
      [],
      {
        candidates: [
          { date: "2026-09-08", start_time: "14:00" },
          { date: "2026-09-08", start_time: "14:30" },
        ],
        message: "候補日程を2件生成しました。",
        sources: [],
      },
      60,
      0,
    );

    expect(applied.candidates.map((candidate) => candidate.id)).toEqual([
      "candidate-0",
    ]);
    expect(applied.report.skipped).toHaveLength(1);
    // 見送った分で採番を飛ばさない（クリックが断られたときと同じ約束）。
    expect(applied.nextSequence).toBe(1);
  });

  /* 業務時間の外も2週間の外も受け入れる（描けないだけで候補日程としては正しい）。 */
  it("カレンダーに描けない日時も加算する", () => {
    const applied = applyAiCandidates(
      [],
      {
        candidates: [{ date: "2026-10-15", start_time: "08:00" }],
        message: "候補日程を1件生成しました。",
        sources: [],
      },
      60,
      0,
    );

    expect(applied.candidates.length).toBe(1);
    expect(applied.report.skipped).toEqual([]);
  });
});

/**
 * プレビューの一覧（ADR-0006、設計書 3.6.1節）。
 *
 * WHY テストを持つか: この一覧の行は「埋まらなかったかもしれない欄」ではなく AI が
 * 作った候補日程そのもので、0件だったことは行が無いことで表れる（`previewTone` が
 * それを聞き返しとして読む）。加算になった今は**押しても入らない候補日程**も出るので、
 * 見送る条件を反映と同じ関数から引いていることまでを押さえる。
 */
describe("newCandidatePreviewItems", () => {
  it("所要時間から導いた時間帯を添えて並べる", () => {
    expect(
      newCandidatePreviewItems(
        [],
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
      [],
      [
        { date: "2026-10-15", start_time: "14:00" },
        { date: "2026-10-15", start_time: "14:00" },
      ],
      30,
    );
    expect(new Set(items.map((item) => item.key)).size).toBe(2);
  });

  it("0件なら行を持たない（聞き返しの合図になる）", () => {
    expect(newCandidatePreviewItems([], [], 30)).toEqual([]);
  });

  it("重なって入らない候補日程は錠を付けて理由を添える", () => {
    expect(
      newCandidatePreviewItems(
        [MANUAL],
        [{ date: "2026-09-08", start_time: "14:30" }],
        60,
      ),
    ).toEqual([
      {
        key: "0-2026-09-08-14:30",
        label: "9月8日(火) 14:30–15:30",
        preserved: true,
        preservedReason: "既に選んだ候補日程と重なります",
      },
    ]);
  });
});
