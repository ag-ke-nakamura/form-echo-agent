import type {
  ParseReservationOutput,
  RouteCandidate,
} from "@/lib/contracts/types";
import { describe, expect, it } from "vitest";
import {
  addCompanion,
  applyToReservation,
  cardCount,
  DEFAULT_ROUND_TRIP,
  EMPTY_FORM,
  EMPTY_RESERVATION,
  type FormState,
  removeCompanion,
  type ReservationState,
  reservationBreakdown,
  reservationInput,
  reservationPreviewItems,
  resetReservation,
  setCardCount,
  setCompanionName,
  setFieldValue,
} from "./reservation-form";

function output(
  overrides: Partial<ParseReservationOutput> = {},
): ParseReservationOutput {
  return {
    borrow_at: null,
    return_at: null,
    origin: null,
    destination: null,
    origin_nearest: null,
    destination_nearest: null,
    round_trip: null,
    purpose: null,
    companion_count: null,
    route_candidates: [],
    message: "",
    sources: [],
    ...overrides,
  };
}

/** 採用済みの経路候補（#100）。`route`/`fare` 以外は反映に使わないので固定値で埋める。 */
function selectedCandidate(
  overrides: Partial<RouteCandidate> = {},
): RouteCandidate {
  return {
    route: "東京 => 大阪",
    fare: "14720円",
    duration: "2時間30分",
    transfer_count: 0,
    is_selected: true,
    reason: "運賃が最安",
    commuter_pass_overlap_sections: null,
    ...overrides,
  };
}

/** 欄だけを埋めたタブの状態。同行者・利用枚数は初期状態のまま。 */
function stateWith(fields: Partial<FormState>): ReservationState {
  return { ...EMPTY_RESERVATION, fields: { ...EMPTY_FORM, ...fields } };
}

/**
 * プレビューの一覧（ADR-0006）。押す前に何が入るのかを職員が読む唯一の場所。
 *
 * WHY テストを持つか: 読み取れなかった欄を落とすと聞き返しの判断が
 * 「全部埋まった」に倒れ（`previewTone`）、空のプレビューが青いまま反映できてしまう。
 * 利用目的は契約の値と職員が読む語が違うので、素通しにするとその欄だけ
 * 「押す前に確認する」が果たせない。
 */
describe("reservationPreviewItems", () => {
  it("読み取れなかった欄も行として残す", () => {
    const items = reservationPreviewItems(
      output({ origin: "東京", destination: "大阪" }),
      EMPTY_RESERVATION,
    );
    expect(items).toEqual([
      {
        key: "round_trip",
        label: "往復区分",
        value: null,
        preserved: false,
        optional: true,
      },
      {
        key: "borrow_at",
        label: "借りる日",
        value: null,
        preserved: false,
        optional: true,
      },
      {
        key: "return_at",
        label: "返す日時",
        value: null,
        preserved: false,
        optional: true,
      },
      {
        key: "origin",
        label: "出発地",
        value: "東京",
        preserved: false,
        optional: true,
      },
      {
        key: "destination",
        label: "目的地",
        value: "大阪",
        preserved: false,
        optional: true,
      },
      {
        key: "route",
        label: "移動経路",
        value: null,
        preserved: false,
        optional: false,
      },
      {
        key: "transport_cost",
        label: "交通費",
        value: null,
        preserved: false,
        optional: false,
      },
      {
        key: "purpose",
        label: "利用目的",
        value: null,
        preserved: false,
        optional: true,
      },
    ]);
  });

  /*
    聞き返しの分母（#168）。フォームだけで生成した回に借りる日・返す日時・利用目的が
    空なのは正しい姿で、そこで黄が出ると成功の回が失敗に見える。移動経路と運賃は
    この往復で AI が調べてくるものなので、欠けていれば本当に聞き返すべき回。
  */
  it("移動経路と運賃だけが聞き返しの分母に入る", () => {
    const items = reservationPreviewItems(output(), EMPTY_RESERVATION);
    const denominator = items
      .filter((item) => item.optional !== true)
      .map((item) => item.key);
    expect(denominator).toEqual(["route", "transport_cost"]);
  });

  it("往復区分は職員が読む語に写す", () => {
    const items = reservationPreviewItems(
      output({ round_trip: "one_way" }),
      EMPTY_RESERVATION,
    );
    expect(items.find((item) => item.key === "round_trip")?.value).toBe("片道");
  });

  it("利用目的は職員が読む語に写す", () => {
    const items = reservationPreviewItems(
      output({ purpose: "training" }),
      EMPTY_RESERVATION,
    );
    expect(items.find((item) => item.key === "purpose")?.value).toBe("研修");
  });

  /*
    プレビューが「押したら入る」と偽らないことの検査（ADR-0006）。判定は
    `applyToReservation` と同じ条件を引いているので、片方だけ動けばここが落ちる。
  */
  it("手で入れた欄は、読み取れていても変わらない印を付ける", () => {
    const current = stateWith({ origin: { value: "横浜", source: "manual" } });
    const items = reservationPreviewItems(output({ origin: "東京" }), current);
    const origin = items.find((item) => item.key === "origin");
    expect(origin).toEqual({
      key: "origin",
      label: "出発地",
      value: "東京",
      preserved: true,
      optional: true,
    });
    // 実際に反映しても変わらない。
    expect(
      applyToReservation(current, output({ origin: "東京" })).next.fields
        .origin,
    ).toEqual({ value: "横浜", source: "manual" });
  });

  it("手で空にした欄にも守る印を付ける（消したのは意図）", () => {
    const current = stateWith({ origin: { value: "", source: "manual" } });
    const items = reservationPreviewItems(output({ origin: "東京" }), current);
    expect(items.find((item) => item.key === "origin")?.preserved).toBe(true);
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
describe("applyToReservation", () => {
  it("読み取れた欄だけを AI 由来として入れる", () => {
    const { next, report } = applyToReservation(
      EMPTY_RESERVATION,
      /*
        出発地・目的地とその最寄が揃っていないと経路候補は返らない（#172。契約の
        `.refine()`）ので、経路が入る回のフィクスチャは4つとも埋める。
      */
      output({
        origin: "東京",
        destination: "大阪",
        origin_nearest: "東京駅",
        destination_nearest: "新大阪駅",
        route_candidates: [selectedCandidate({ route: "東京駅 => 新大阪駅" })],
      }),
    );
    expect(next.fields.origin).toEqual({ value: "東京", source: "ai" });
    expect(next.fields.route).toEqual({
      value: "東京駅 => 新大阪駅",
      source: "ai",
    });
    expect(next.fields.transport_cost).toEqual({
      value: "14720円",
      source: "ai",
    });
    // 読み取れなかった欄は触らない。
    expect(next.fields.borrow_at).toEqual(EMPTY_FORM.borrow_at);
    expect(report).toEqual({
      updated: ["出発地", "目的地", "移動経路", "交通費"],
      preserved: [],
    });
  });

  /**
   * 経路候補が0件（=経路を特定できなかった）のときは、既存の null と同じ扱いになる
   * こと（#100）。`route_candidates` が空配列なら `selectedRouteCandidate` は
   * 何も見つけられず、`route`/`transport_cost` は触らない。
   */
  it("経路候補が0件のときは移動経路・交通費を触らない", () => {
    const { next, report } = applyToReservation(
      EMPTY_RESERVATION,
      output({ origin: "東京", route_candidates: [] }),
    );
    expect(next.fields.route).toEqual(EMPTY_FORM.route);
    expect(next.fields.transport_cost).toEqual(EMPTY_FORM.transport_cost);
    expect(report.updated).toEqual(["出発地"]);
  });

  /*
    日付・日時は出力契約が `YYYY-MM-DD` / `YYYY-MM-DDTHH:mm` を保証するので、
    `<input type="date">` / `<input type="datetime-local">` へそのまま渡せる。
    整形を挟むと契約の形と画面の形が二重定義になる。
  */
  it("日付・日時は出力契約の形のままフォームへ入る", () => {
    const { next, report } = applyToReservation(
      EMPTY_RESERVATION,
      output({ borrow_at: "2026-10-15", return_at: "2026-10-18T18:00" }),
    );
    expect(next.fields.borrow_at).toEqual({
      value: "2026-10-15",
      source: "ai",
    });
    expect(next.fields.return_at).toEqual({
      value: "2026-10-18T18:00",
      source: "ai",
    });
    expect(report.updated).toEqual(["借りる日", "返す日時"]);
  });

  it("手で書いた欄は上書きせず、守ったことを報告に載せる", () => {
    const current = stateWith({ origin: { value: "横浜", source: "manual" } });
    const { next, report } = applyToReservation(
      current,
      output({ origin: "東京" }),
    );
    expect(next.fields.origin).toEqual({ value: "横浜", source: "manual" });
    expect(report).toEqual({ updated: [], preserved: ["出発地"] });
  });

  /*
    「消す」で空にした欄は `{ value: "", source: "manual" }` になる。初期状態が
    `"default"` になったことでこれと区別が付き、消したまま残せる（ADR-0018）。
  */
  it("手で空にした欄は埋め直さず、守ったことを報告に載せる", () => {
    const current = stateWith({ origin: { value: "", source: "manual" } });
    const { next, report } = applyToReservation(
      current,
      output({ origin: "東京" }),
    );
    expect(next.fields.origin).toEqual({ value: "", source: "manual" });
    expect(report).toEqual({ updated: [], preserved: ["出発地"] });
  });

  /* 初期状態は「既定値」。手入力ではないので AI が上書きできる（ADR-0018）。 */
  it("フォームの初期状態は既定値で、AI が上書きできる", () => {
    expect(EMPTY_FORM.origin).toEqual({ value: "", source: "default" });
    const { next, report } = applyToReservation(
      EMPTY_RESERVATION,
      output({ origin: "東京" }),
    );
    expect(next.fields.origin).toEqual({ value: "東京", source: "ai" });
    expect(report.preserved).toEqual([]);
  });

  it("同じ値を読み取り直した欄は更新に数えない", () => {
    const current = stateWith({ origin: { value: "東京", source: "ai" } });
    const { next, report } = applyToReservation(
      current,
      output({ origin: "東京", destination: "大阪" }),
    );
    expect(next.fields.origin).toEqual({ value: "東京", source: "ai" });
    expect(report).toEqual({ updated: ["目的地"], preserved: [] });
  });
});

/**
 * Runtime へ渡す与件（ADR-0017・ADR-0018）。
 *
 * WHY テストを持つか: `is_manual` は**規則の入口**である。true になると AI は与件を
 * 直さず聞き返し、false なら追加指示で書き換える。プレプリントのまま（`"default"`）を
 * 手入力と数えると、指南書が求める主な流れ（プレプリントを放置して追加指示に書く）が
 * 毎回聞き返しになる。
 */
describe("reservationInput", () => {
  it("既定値のままなら手入力ではない（AI が直せる）", () => {
    expect(reservationInput(EMPTY_FORM)).toEqual({
      // 空欄も与件として渡す（#170）。渡さないと AI は古いフォームを最後の与件と読む。
      origin: { value: "", is_manual: false },
      destination: { value: "", is_manual: false },
      round_trip: { value: DEFAULT_ROUND_TRIP, is_manual: false },
    });
  });

  it("職員が選ぶと手入力になる", () => {
    const state = setFieldValue(EMPTY_RESERVATION, "round_trip", "one_way");
    expect(reservationInput(state.fields).round_trip).toEqual({
      value: "one_way",
      is_manual: true,
    });
  });

  /*
    #170: 手入力の出発地は AI が黙って書き換えられない側に回る（追加指示と食い違えば
    聞き返す）。印が落ちると、出発地は霞ヶ関のまま経路だけ新宿から始まるフォームができる。
  */
  it("職員が打った出発地・目的地は手入力になる", () => {
    const typed = setFieldValue(
      setFieldValue(EMPTY_RESERVATION, "origin", "霞ヶ関"),
      "destination",
      "虎ノ門ヒルズ",
    );
    const input = reservationInput(typed.fields);
    expect(input.origin).toEqual({ value: "霞ヶ関", is_manual: true });
    expect(input.destination).toEqual({
      value: "虎ノ門ヒルズ",
      is_manual: true,
    });
  });

  /* AI バッジは「再生成で上書きされる範囲」の印でもある（#38）ので false 側。 */
  it("前回 AI が入れた値は手入力ではない", () => {
    const { next } = applyToReservation(
      EMPTY_RESERVATION,
      output({ round_trip: "one_way", origin: "新宿" }),
    );
    const input = reservationInput(next.fields);
    expect(input.round_trip).toEqual({ value: "one_way", is_manual: false });
    expect(input.origin).toEqual({ value: "新宿", is_manual: false });
  });

  /* 「消す」で空にした欄は手入力である（ADR-0018）。空欄でも印は落ちない。 */
  it("職員が消した出発地は空でも手入力のまま", () => {
    const typed = setFieldValue(EMPTY_RESERVATION, "origin", "霞ヶ関");
    const cleared = setFieldValue(typed, "origin", "");
    expect(reservationInput(cleared.fields).origin).toEqual({
      value: "",
      is_manual: true,
    });
  });
});

/**
 * 往復区分の写す規則（#168）。与件でありながら出力にも載る唯一の欄。
 */
describe("往復区分", () => {
  it("初期状態は往復のプレプリントで、AI が上書きできる", () => {
    expect(EMPTY_FORM.round_trip).toEqual({
      value: "round",
      source: "default",
    });
    const { next, report } = applyToReservation(
      EMPTY_RESERVATION,
      output({ round_trip: "one_way" }),
    );
    expect(next.fields.round_trip).toEqual({ value: "one_way", source: "ai" });
    expect(report).toEqual({ updated: ["往復区分"], preserved: [] });
  });

  it("職員が選んだ値は上書きしない", () => {
    const current = stateWith({
      round_trip: { value: "one_way", source: "manual" },
    });
    const { next, report } = applyToReservation(
      current,
      output({ round_trip: "round" }),
    );
    expect(next.fields.round_trip).toEqual({
      value: "one_way",
      source: "manual",
    });
    expect(report).toEqual({ updated: [], preserved: ["往復区分"] });
  });
});

/**
 * 同行者の行とICカード利用枚数（#68・#167）。
 *
 * WHY テストを持つか: 行の識別子は React の key であり、**同時に並ぶ行の間で一意**で
 * なければ、消した行と新しい行が React から同じものに見えて入力中の氏名が別の行へ
 * 移る。行を消しても番号を戻さないのがその歯止めで、画面を描かずに確かめられるのは
 * ここへ出したからである。
 */
describe("同行者の行", () => {
  it("追加すると空の氏名の行が末尾に増える", () => {
    const state = addCompanion(addCompanion(EMPTY_RESERVATION));
    expect(state.companions).toEqual([
      { id: "companion-0", name: "" },
      { id: "companion-1", name: "" },
    ]);
  });

  it("消した行の番号は再利用しない", () => {
    const two = addCompanion(addCompanion(EMPTY_RESERVATION));
    const state = addCompanion(removeCompanion(two, "companion-0"));
    expect(state.companions.map((row) => row.id)).toEqual([
      "companion-1",
      "companion-2",
    ]);
  });

  it("氏名の変更はその行だけに掛かる", () => {
    const two = addCompanion(addCompanion(EMPTY_RESERVATION));
    const state = setCompanionName(two, "companion-1", "田中");
    expect(state.companions).toEqual([
      { id: "companion-0", name: "" },
      { id: "companion-1", name: "田中" },
    ]);
  });
});

/**
 * 「最初からやり直す」（#65）。**AI 由来の欄だけを消す操作ではなく、フォームを初期状態
 * へ戻す操作**である。
 *
 * WHY テストを持つか: 消す対象が AI の欄・同行者・利用枚数の3箇所に分かれており、
 * 足したときに戻し忘れやすい。行番号だけは持ち越す（消した行の番号を再利用しない）ので、
 * 「全部初期値に戻す」で片付けると壊れる。
 */
describe("resetReservation", () => {
  const filled = setCardCount(
    setCompanionName(
      addCompanion(setFieldValue(EMPTY_RESERVATION, "origin", "横浜")),
      "companion-0",
      "田中",
    ),
    "2",
  );

  it("手で入れた欄・同行者・利用枚数がすべて消える", () => {
    // 埋める側が空回りしていないこと（戻した後との比較が意味を持つ前提）。
    expect(filled).not.toEqual(EMPTY_RESERVATION);

    const reset = resetReservation(filled);
    expect(reset.fields).toEqual(EMPTY_FORM);
    expect(reset.companions).toEqual([]);
    // 利用枚数は手入力の固定が外れ、導出（同行者0人 + 職員）へ戻る。
    expect(cardCount(reset)).toBe("1");
  });

  it("行番号は持ち越す", () => {
    expect(resetReservation(filled).nextCompanionNumber).toBe(
      filled.nextCompanionNumber,
    );
  });
});

/**
 * 同行者の人数の反映（#176）。**氏名は受けない**ので、AI が作るのは空の行だけである。
 *
 * WHY テストを持つか: 数え方の取り違え（「Xさんと2人で」＝同行者1人）も、行を作る
 * 条件（1つでもあれば触らない）も、**行のラベルが連番なので画面を見ても気付けない。**
 * 職員が名前を書いた行を AI が消すのはこの規則が1つ崩れるだけで起きる。
 */
describe("同行者の人数の反映", () => {
  it("人数が読み取れなければ行を作らず、報告にも載せない", () => {
    const { next, report } = applyToReservation(
      EMPTY_RESERVATION,
      output({ companion_count: null }),
    );
    expect(next.companions).toEqual([]);
    expect(report).toEqual({ updated: [], preserved: [] });
  });

  it("行が1つも無いときだけ、人数ぶんの空の行を作る", () => {
    const { next, report } = applyToReservation(
      EMPTY_RESERVATION,
      output({ companion_count: 2 }),
    );
    expect(next.companions).toEqual([
      { id: "companion-0", name: "" },
      { id: "companion-1", name: "" },
    ]);
    expect(next.nextCompanionNumber).toBe(2);
    expect(report).toEqual({ updated: ["同行者"], preserved: [] });
  });

  /* 0人は「一人で行く」と書かれた回。作る行が無いので報告にも載らない。 */
  it("0人なら行を作らない", () => {
    const { next, report } = applyToReservation(
      EMPTY_RESERVATION,
      output({ companion_count: 0 }),
    );
    expect(next.companions).toEqual([]);
    expect(report).toEqual({ updated: [], preserved: [] });
  });

  it("行が1つでもあれば触らず、守ったことを報告に載せる", () => {
    const current = setCompanionName(
      addCompanion(EMPTY_RESERVATION),
      "companion-0",
      "田中",
    );
    const { next, report } = applyToReservation(
      current,
      output({ companion_count: 3 }),
    );
    expect(next.companions).toEqual([{ id: "companion-0", name: "田中" }]);
    expect(report).toEqual({ updated: [], preserved: ["同行者"] });
  });

  /* 総数に合わせて減らすことはしない（職員が足した行を消さない）。 */
  it("読み取れた人数より行が多くても減らさない", () => {
    const current = addCompanion(addCompanion(EMPTY_RESERVATION));
    const { next } = applyToReservation(
      current,
      output({ companion_count: 1 }),
    );
    expect(next.companions).toHaveLength(2);
  });

  /* 行番号は消した行のぶんを飛ばして続く（React の key が衝突しない）。 */
  it("作る行の番号は消した行のぶんを飛ばして続く", () => {
    const emptied = removeCompanion(
      addCompanion(EMPTY_RESERVATION),
      "companion-0",
    );
    const { next } = applyToReservation(
      emptied,
      output({ companion_count: 2 }),
    );
    expect(next.companions.map((row) => row.id)).toEqual([
      "companion-1",
      "companion-2",
    ]);
  });
});

/**
 * ICカード利用枚数（#176）。**同行者の行数から導く。**
 *
 * WHY テストを持つか: 同じ数を2箇所に入れさせないための導出なので、**放置すれば必ず
 * 食い違う**側（AI が2行作ったのを見てから隣の欄に手で3と打つ）を再現できないと、
 * 導出が壊れても画面は前と同じに見える。職員が上書きできることは、自分のICカードを
 * 持っている同行者がいる回のために要る。
 */
describe("ICカード利用枚数", () => {
  it("既定は同行者の行数 + 1（職員のぶん）", () => {
    expect(cardCount(EMPTY_RESERVATION)).toBe("1");
    expect(cardCount(addCompanion(addCompanion(EMPTY_RESERVATION)))).toBe("3");
  });

  it("AI が作った行にも追随する", () => {
    const { next } = applyToReservation(
      EMPTY_RESERVATION,
      output({ companion_count: 2 }),
    );
    expect(cardCount(next)).toBe("3");
  });

  it("職員が触ったら固定され、行が増えても動かない", () => {
    const fixed = setCardCount(EMPTY_RESERVATION, "2");
    expect(cardCount(fixed)).toBe("2");
    expect(cardCount(addCompanion(fixed))).toBe("2");
  });

  /* 「消す」で空にしたのは意図（ADR-0018）。行が増えても埋め直さない。 */
  it("手で空にしたら空のまま残る", () => {
    const cleared = setCardCount(EMPTY_RESERVATION, "");
    expect(cardCount(addCompanion(cleared))).toBe("");
  });
});

/**
 * プレビューの同行者の行（#176）。
 *
 * WHY テストを持つか: **読み取れなかったときに行を出さない**ことが要件である。普通の
 * 出張は同行者がいないので、毎回「同行者: （未入力）」が並ぶと聞き返しが意味を失う。
 */
describe("プレビューの同行者の行", () => {
  it("人数が読み取れたときだけ出る", () => {
    expect(
      reservationPreviewItems(output(), EMPTY_RESERVATION).some(
        (item) => item.key === "companions",
      ),
    ).toBe(false);
    const items = reservationPreviewItems(
      output({ companion_count: 2 }),
      EMPTY_RESERVATION,
    );
    expect(items.find((item) => item.key === "companions")).toEqual({
      key: "companions",
      label: "同行者",
      value: "2人",
      preserved: false,
      optional: true,
    });
  });

  /* 0人は作る行が無い。錠が無いと反映のボタンが生きる（`hasApplicableItems`）。 */
  it("0人には錠を付ける（押しても何も起きない）", () => {
    const items = reservationPreviewItems(
      output({ companion_count: 0 }),
      EMPTY_RESERVATION,
    );
    const companions = items.find((item) => item.key === "companions");
    expect(companions?.value).toBe("0人");
    expect(companions?.preserved).toBe(true);
    expect(companions?.preservedReason).toBe("作る行はありません");
  });

  it("既に行があるときは変わらないと分かる", () => {
    const current = addCompanion(EMPTY_RESERVATION);
    const items = reservationPreviewItems(
      output({ companion_count: 2 }),
      current,
    );
    const companions = items.find((item) => item.key === "companions");
    expect(companions?.preserved).toBe(true);
    expect(companions?.preservedReason).toBe(
      "同行者の行が既にあるため変更しません",
    );
  });
});

/**
 * AI提案の内訳（#172。設計書 2.1節）。
 *
 * WHY テストを持つか: **抽出項目の一覧と分母が違う。** 内訳は欄と対応しない行なので、
 * 一覧に混ぜると聞き返しの判定（`previewTone`）が欄でない行を数える。空のときに
 * 領域ごと消えることも要件で、見出しだけが残ると「調べたが根拠が無い」に読める。
 */
describe("reservationBreakdown", () => {
  it("検索条件として出発地・目的地とその最寄を並べる", () => {
    const sections = reservationBreakdown(
      output({
        origin: "虎ノ門ヒルズ",
        destination: "横浜市役所",
        origin_nearest: "虎ノ門駅",
        destination_nearest: "桜木町駅",
        route_candidates: [selectedCandidate()],
      }),
    );
    expect(sections).toEqual([
      {
        key: "search-conditions",
        label: "検索条件",
        lines: [
          "出発地：虎ノ門ヒルズ（最寄：虎ノ門駅）",
          "目的地：横浜市役所（最寄：桜木町駅）",
        ],
      },
    ]);
  });

  /* 出る回と出ない回があると、職員は必要な回に出ているかを確かめられない。 */
  it("出発地が既に駅名でも最寄を省かない", () => {
    const [section] = reservationBreakdown(
      output({
        origin: "霞ヶ関駅",
        destination: "虎ノ門駅",
        origin_nearest: "霞ケ関駅",
        destination_nearest: "虎ノ門駅",
        route_candidates: [selectedCandidate()],
      }),
    );
    expect(section?.lines).toEqual([
      "出発地：霞ヶ関駅（最寄：霞ケ関駅）",
      "目的地：虎ノ門駅（最寄：虎ノ門駅）",
    ]);
  });

  /* 領域そのものを出さない。理由は AI の `message` が言う。 */
  it("経路候補が0件なら内訳を出さない", () => {
    expect(
      reservationBreakdown(
        output({ origin: "東京", destination: "大阪", route_candidates: [] }),
      ),
    ).toEqual([]);
  });
});
