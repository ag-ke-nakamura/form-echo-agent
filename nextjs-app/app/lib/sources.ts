/**
 * AI が返した参照元 URL を画面に出せる形に直す（#46）。
 *
 * **`sources` の中身はモデルが書いた文字列**で、出力契約は `z.array(z.string())` と
 * しか言わない（URL であることまでは検査していない）。そのまま `href` に置くと
 * `javascript:` が実行される経路になるので、画面へ渡す前にここで絞る。
 *
 * 契約側ではなくここに置くのは、**引くのが画面だけ**だから（`meeting-info.ts` が
 * 終了時刻の導出を持つのと同じ理由）。BFF は `sources` を素通しするので、
 * 表示のための判断を契約に載せると誰も引かない関数が増える。
 */

/** 画面に出す1件。`label` はリンクの文字列、`url` は `href` に入る値。 */
export interface LinkableSource {
  url: string;
  label: string;
}

/**
 * リンクとして出せる参照元だけを、重複を落として返す。
 *
 * 落とすもの: `http` / `https` 以外（`javascript:` や `data:`）、URL として
 * 解釈できない文字列、同じ URL の2件目。**空配列なら空配列を返す** — 画面は
 * その場合に何も描かない（検索を使わなかった往復で見出しだけが残らないように）。
 */
export function linkableSources(sources: readonly string[]): LinkableSource[] {
  const seen = new Set<string>();
  const linkable: LinkableSource[] = [];

  for (const source of sources) {
    let parsed: URL;
    try {
      parsed = new URL(source);
    } catch {
      continue;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") continue;
    if (seen.has(parsed.href)) continue;
    seen.add(parsed.href);
    /*
      ラベルはホスト名にする。URL 全体を出すと時刻表ページのような長いクエリ文字列が
      そのまま行に伸びて、何件あるのかが読めなくなる。職員が知りたいのは「どこの
      情報か」で、JR 東海なのか個人のブログなのかはホスト名で付く。
    */
    linkable.push({ url: parsed.href, label: parsed.hostname });
  }

  return linkable;
}
