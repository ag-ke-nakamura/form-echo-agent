import { describe, expect, it } from "vitest";
import { linkableSources } from "./sources";

describe("linkableSources", () => {
  it("参照元をリンクとホスト名の組にする", () => {
    expect(
      linkableSources(["https://www.jr-odekake.net/navi/time/?a=1"]),
    ).toEqual([
      {
        url: "https://www.jr-odekake.net/navi/time/?a=1",
        label: "www.jr-odekake.net",
      },
    ]);
  });

  it("検索を使わなかったときは何も出さない", () => {
    // 空配列のまま画面に何も出ないこと自体が受け入れ条件（#46）。見出しだけが
    // 残ると、職員には「検索したが根拠が無い」ように見える。
    expect(linkableSources([])).toEqual([]);
  });

  it("http / https 以外は落とす", () => {
    // `sources` の中身はモデルが書いた文字列で、出力契約は URL であることまで
    // 検査していない。そのまま href に置くと `javascript:` が実行される。
    expect(
      linkableSources([
        "javascript:alert(1)",
        "data:text/html,<script>alert(1)</script>",
        "https://www.jreast.co.jp/",
      ]).map((source) => source.url),
    ).toEqual(["https://www.jreast.co.jp/"]);
  });

  it("URL として解釈できない文字列は落とす", () => {
    // 「検索結果より」のような文をモデルが入れてくることがある。
    expect(linkableSources(["検索結果より", "www.example.jp"])).toEqual([]);
  });

  it("同じ URL は1件にまとめる", () => {
    // 3回の検索が同じページを返すことは普通にある。並べると根拠が多いように見える。
    expect(
      linkableSources([
        "https://www.jreast.co.jp/",
        "https://www.jreast.co.jp/",
      ]),
    ).toHaveLength(1);
  });

  it("並び順は AI が返した順のまま", () => {
    // 根拠として先に挙げたものを先に出す。こちらで並べ替える理由が無い。
    expect(
      linkableSources(["https://b.example.jp/", "https://a.example.jp/"]).map(
        (source) => source.label,
      ),
    ).toEqual(["b.example.jp", "a.example.jp"]);
  });
});
