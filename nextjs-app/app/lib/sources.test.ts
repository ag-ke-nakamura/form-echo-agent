import type { WebSearchCitation } from "@contracts/index.js";
import { describe, expect, it } from "vitest";
import { linkableSources } from "./sources";

function citation(
  overrides: Partial<WebSearchCitation> = {},
): WebSearchCitation {
  return {
    title: "東京から新大阪 時刻表（ＪＲ東海道新幹線）",
    url: "https://www.jr-odekake.net/navi/time/?a=1",
    ...overrides,
  };
}

describe("linkableSources", () => {
  it("出典・リンク・ホスト名の組にする", () => {
    // 「許容される利用方法」が求めるのは citation（タイトル）と link の**両方**。
    // ホスト名だけを出していた頃はタイトルを捨てており、要件を満たしていなかった。
    expect(
      linkableSources([citation({ publishedDate: "2026-08-27T00:00:00Z" })]),
    ).toEqual([
      {
        url: "https://www.jr-odekake.net/navi/time/?a=1",
        label: "東京から新大阪 時刻表（ＪＲ東海道新幹線）",
        host: "www.jr-odekake.net",
        publishedDate: "2026-08-27",
      },
    ]);
  });

  it("コネクタが返す形の公開日を YYYY-MM-DD に直す", () => {
    // 実物はこの形で返ってくる。そのまま並べると日本語の画面で読めない。
    expect(
      linkableSources([
        citation({ publishedDate: "05:00PM, Thursday, August 27 2026, PDT" }),
      ])[0]?.publishedDate,
      // 書かれた暦日をそのまま採る。時差で1日ずらすほうが誤解を生む。
    ).toBe("2026-08-27");
  });

  it("公開日を持たない出典はその欄を持たない", () => {
    expect(linkableSources([citation()])[0]?.publishedDate).toBeUndefined();
  });

  it("読み取れない公開日は捏造せずに落とす", () => {
    // 職員が古さを判断する材料なので、間違った日付は無い方がましである。
    expect(
      linkableSources([citation({ publishedDate: "unknown" })])[0]
        ?.publishedDate,
    ).toBeUndefined();
  });

  it("検索を使わなかったときは何も出さない", () => {
    // 空配列のまま画面に何も出ないこと自体が受け入れ条件（#46）。見出しだけが
    // 残ると、職員には「検索したが根拠が無い」ように見える。
    expect(linkableSources([])).toEqual([]);
  });

  it("タイトルが空なら URL で代える", () => {
    // 出典の欄が空のリンクは、職員にはどこの情報か分からない。
    expect(linkableSources([citation({ title: "   " })])[0]?.label).toBe(
      "https://www.jr-odekake.net/navi/time/?a=1",
    );
  });

  it("http / https 以外は落とす", () => {
    // 契約側で `z.url()` を通っているが、`href` に入る値を素通しする経路を
    // 1つも残さない。契約が緩んだ日に画面が `javascript:` を描き始めないため。
    expect(
      linkableSources([
        citation({ url: "javascript:alert(1)" }),
        citation({ url: "data:text/html,<script>alert(1)</script>" }),
        citation({ url: "https://www.jreast.co.jp/" }),
      ]).map((source) => source.url),
    ).toEqual(["https://www.jreast.co.jp/"]);
  });

  it("URL として解釈できないものは落とす", () => {
    expect(linkableSources([citation({ url: "検索結果より" })])).toEqual([]);
  });

  it("同じ URL は1件にまとめる", () => {
    // 1リクエストで最大3回検索するので、同じページが複数回返る。
    expect(
      linkableSources([
        citation({ url: "https://www.jreast.co.jp/" }),
        citation({ url: "https://www.jreast.co.jp/", title: "別のタイトル" }),
      ]),
    ).toHaveLength(1);
  });

  it("並び順は Runtime が返した順のまま", () => {
    // 取得した順に出す。こちらで並べ替える理由が無い。
    expect(
      linkableSources([
        citation({ url: "https://b.example.jp/" }),
        citation({ url: "https://a.example.jp/" }),
      ]).map((source) => source.host),
    ).toEqual(["b.example.jp", "a.example.jp"]);
  });
});
