import type { ParseReservationOutput } from "@contracts/index.js";
import { describe, expect, it } from "vitest";
import {
  applyToForm,
  EMPTY_FORM,
  type FormState,
  reservationPreviewItems,
} from "./reservation-form";

function output(
  overrides: Partial<ParseReservationOutput> = {},
): ParseReservationOutput {
  return {
    departure_date: null,
    return_date: null,
    origin: null,
    destination: null,
    transport: null,
    message: "",
    sources: [],
    ...overrides,
  };
}

/**
 * プレビューの一覧（ADR-0006）。押す前に何が入るのかを職員が読む唯一の場所。
 *
 * WHY テストを持つか: 読み取れなかった欄を落とすと聞き返しの判断が
 * 「全部埋まった」に倒れ（`previewTone`）、空のプレビューが青いまま反映できてしまう。
 * 交通手段だけは契約の値と職員が読む語が違うので、素通しにするとその欄だけ
 * 「押す前に確認する」が果たせない。
 */
describe("reservationPreviewItems", () => {
  it("読み取れなかった欄も行として残す", () => {
    const items = reservationPreviewItems(
      output({ origin: "東京", destination: "大阪" }),
      EMPTY_FORM,
    );
    expect(items).toEqual([
      { key: "departure_date", label: "出発日", value: null, preserved: false },
      { key: "return_date", label: "帰着日", value: null, preserved: false },
      { key: "origin", label: "出発地", value: "東京", preserved: false },
      { key: "destination", label: "目的地", value: "大阪", preserved: false },
      { key: "transport", label: "交通手段", value: null, preserved: false },
    ]);
  });

  it("交通手段は職員が読む語に写す", () => {
    const items = reservationPreviewItems(
      output({ transport: "train" }),
      EMPTY_FORM,
    );
    expect(items.at(-1)).toEqual({
      key: "transport",
      label: "交通手段",
      value: "鉄道",
      preserved: false,
    });
  });

  /*
    プレビューが「押したら入る」と偽らないことの検査（ADR-0006）。判定は
    `applyToForm` と同じ条件を引いているので、片方だけ動けばここが落ちる。
  */
  it("手で入れた欄は、読み取れていても変わらない印を付ける", () => {
    const current: FormState = {
      ...EMPTY_FORM,
      origin: { value: "横浜", source: "manual" },
    };
    const items = reservationPreviewItems(output({ origin: "東京" }), current);
    const origin = items.find((item) => item.key === "origin");
    expect(origin).toEqual({
      key: "origin",
      label: "出発地",
      value: "東京",
      preserved: true,
    });
    // 実際に反映しても変わらない。
    expect(
      applyToForm(current, output({ origin: "東京" })).next.origin,
    ).toEqual({ value: "横浜", source: "manual" });
  });

  it("手で空にした欄は守らない（既知の穴と揃える）", () => {
    const current: FormState = {
      ...EMPTY_FORM,
      origin: { value: "", source: "manual" },
    };
    const items = reservationPreviewItems(output({ origin: "東京" }), current);
    expect(items.find((item) => item.key === "origin")?.preserved).toBe(false);
  });
});

/**
 * AI の出力をフォームへ写す規則（#38）。
 *
 * WHY テストを持つか: 3つの規則が重なっており（読み取れなかった欄は触らない・手で
 * 直した欄は上書きしない・同じ値は「更新」に数えない）、どれも応答を何度も往復させ
 * ない限り画面には出ない。手入力の保護が壊れると、待っている間に職員が書いた値を
 * 黙って踏み潰す。
 */
describe("applyToForm", () => {
  it("読み取れた欄だけを AI 由来として入れる", () => {
    const { next, report } = applyToForm(
      EMPTY_FORM,
      output({ origin: "東京", transport: "flight" }),
    );
    expect(next.origin).toEqual({ value: "東京", source: "ai" });
    expect(next.transport).toEqual({ value: "flight", source: "ai" });
    // 読み取れなかった欄は触らない。
    expect(next.destination).toEqual(EMPTY_FORM.destination);
    expect(report).toEqual({ updated: ["出発地", "交通手段"], preserved: [] });
  });

  it("手で書いた欄は上書きせず、守ったことを報告に載せる", () => {
    const current: FormState = {
      ...EMPTY_FORM,
      origin: { value: "横浜", source: "manual" },
    };
    const { next, report } = applyToForm(current, output({ origin: "東京" }));
    expect(next.origin).toEqual({ value: "横浜", source: "manual" });
    expect(report).toEqual({ updated: [], preserved: ["出発地"] });
  });

  /* 手で空にした欄は初期状態と区別が付かないので埋め直される（既知の穴）。 */
  it("手で空にした欄は守らない", () => {
    const current: FormState = {
      ...EMPTY_FORM,
      origin: { value: "", source: "manual" },
    };
    const { next, report } = applyToForm(current, output({ origin: "東京" }));
    expect(next.origin).toEqual({ value: "東京", source: "ai" });
    expect(report.updated).toEqual(["出発地"]);
  });

  it("同じ値を読み取り直した欄は更新に数えない", () => {
    const current: FormState = {
      ...EMPTY_FORM,
      origin: { value: "東京", source: "ai" },
    };
    const { next, report } = applyToForm(
      current,
      output({ origin: "東京", destination: "大阪" }),
    );
    expect(next.origin).toEqual({ value: "東京", source: "ai" });
    expect(report).toEqual({ updated: ["目的地"], preserved: [] });
  });
});
