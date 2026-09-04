import type { WebSearchCitation } from "@contracts/index.js";

/**
 * Web 検索の出典を画面に出せる形に直す（#46）。
 *
 * **表示は義務である。** AWS の Web Search Tool の「許容される利用方法」が
 * 「You must retain and display the source citations and links provided with each
 * Search Result in any output you surface to your end users that uses the Search
 * Result.」としているので、検索結果を使った回答を出典なしで職員に見せてはいけない。
 *
 * 引くのは **BFF が通した `citations`** であって、AI が書いた `result.sources` では
 * ない。`sources` はモデルの申告なので、申告漏れ（使ったのに載せない）と、検索結果に
 * 無い URL の混入の両方が起こる。**規約の遵守をモデルの協力に依存させない。**
 *
 * ここに置くのは画面だけが引くから（`meeting-info.ts` が終了時刻の導出を持つのと
 * 同じ理由）。BFF は `citations` を素通しするので、表示のための判断を契約に載せると
 * 誰も引かない関数が増える。
 */

/** 画面に出す1件。`label` はリンクの文字列、`url` は `href` に入る値。 */
export interface LinkableSource {
  url: string;
  /** 出典（ページのタイトル）。 */
  label: string;
  /** どこの情報かを一目で分かるようにするホスト名。 */
  host: string;
  /**
   * 公開日（`YYYY-MM-DD`）。読み取れないときは持たない。
   *
   * 経路の裏取りでは**いつのページか**が結果の重みを決める（ダイヤは改正で変わる）
   * ので画面に出す。
   */
  publishedDate?: string;
}

/** 英語の月名から月番号へ。コネクタが返す散文の日付を読むために引く。 */
const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

/**
 * コネクタが返す公開日を `YYYY-MM-DD` に直す。
 *
 * **2つの形が来る。** AWS のドキュメントの例は `2024-10-07` だが、実物は
 * `05:00PM, Thursday, August 27 2026, PDT` の形でも返ってくる（後者は `new Date()`
 * が解釈できない）。日本語の画面に散文の日付を5件並べると読めないので、どちらも
 * 日付だけに落とす。
 *
 * **読み取れなかったときは捏造せずに持たない。** 職員が古さを判断する材料なので、
 * 間違った日付は無い方がましである（コネクタは分からないときに `unknown` を返す）。
 *
 * 散文の側は書かれた暦日をそのまま採り、タイムゾーンを跨いで動かさない。ページの
 * 公開日として書かれた日付を1日ずらすほうが、時差を正確に扱うより誤解を生む。
 */
function toIsoDate(publishedDate: string | undefined): string | undefined {
  if (publishedDate === undefined) return undefined;

  const prose = publishedDate.match(/([A-Za-z]+)\s+(\d{1,2})[,\s]+(\d{4})/);
  if (prose !== null) {
    const month = MONTHS.indexOf((prose[1] ?? "").toLowerCase());
    if (month >= 0) {
      const day = (prose[2] ?? "").padStart(2, "0");
      return `${prose[3]}-${String(month + 1).padStart(2, "0")}-${day}`;
    }
  }

  const parsed = new Date(publishedDate);
  if (Number.isNaN(parsed.getTime())) return undefined;
  // `sv-SE` ロケールが YYYY-MM-DD を返す（`system-prompt.ts` と同じ手）。
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
    dateStyle: "short",
  }).format(parsed);
}

/**
 * リンクとして出せる出典だけを、重複を落として返す。
 *
 * 落とすもの: `http` / `https` 以外（`javascript:` や `data:`）、URL として
 * 解釈できない文字列、同じ URL の2件目。**空配列なら空配列を返す** — 画面は
 * その場合に何も描かない（検索を使わなかった往復で見出しだけが残らないように）。
 *
 * 契約側で `z.url()` を通っているが、ここでも見る。**`href` に入る値を素通しする
 * 経路を1つも残さない**ためで、契約が緩んだ日に画面が `javascript:` を描き始める
 * ことを防ぐ。
 */
export function linkableSources(
  citations: readonly WebSearchCitation[],
): LinkableSource[] {
  const seen = new Set<string>();
  const linkable: LinkableSource[] = [];

  for (const citation of citations) {
    let parsed: URL;
    try {
      parsed = new URL(citation.url);
    } catch {
      continue;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") continue;
    if (seen.has(parsed.href)) continue;
    seen.add(parsed.href);
    const publishedDate = toIsoDate(citation.publishedDate);
    linkable.push({
      url: parsed.href,
      // タイトルが空なら URL で代える。出典の欄が空のリンクは、職員には
      // どこの情報か分からない。
      label: citation.title.trim() === "" ? parsed.href : citation.title,
      host: parsed.hostname,
      ...(publishedDate === undefined ? {} : { publishedDate }),
    });
  }

  return linkable;
}
