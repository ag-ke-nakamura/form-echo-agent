import type { ReactNode } from "react";

/**
 * タブの見出し（設計書 2.2節「ページヘッダー」）。
 *
 * 見出しの文言は設計書がそれぞれの画面に与えたもの（「交通ICカード予約申請」など）を
 * そのまま使う。設計書とコードを1対1で突き合わせてレビューできるようにするため。
 */
export function TabHeading({ children }: { children: ReactNode }) {
  return (
    <h2 className="mb-6 text-std-28B-150 text-solid-gray-900">{children}</h2>
  );
}

/**
 * AI入力アシスタントと非AI経路のフォームの間に入る区切り（設計書 4節）。
 *
 * WHY: AI を使わない選択肢が同じ画面に同じ重さで存在することを、線と語で示す。
 * 2カラム（左フォーム・右チャット）をやめたのはこのためで、縦に積んだうえで
 * 「または」と書かないと、上のアシスタントが唯一の入り口に見える。
 *
 * 設計書はタブごとに文言を変えている（タブ2「カレンダーで直接選択」、タブ3
 * 「各候補に直接入力」）。**その非AI経路が設計書の形になったタブだけが設計書の
 * 文言を名乗る** — 先に文言だけ合わせると画面に無いものを指す。タブ2のカレンダーは
 * まだ無い（#69）ので、既定は「手動で入力」のまま置く。
 */
export function ManualInputDivider({
  label = "または、手動で入力",
}: {
  label?: string;
} = {}) {
  return (
    <div className="my-8 flex items-center gap-4">
      <div className="flex-1 border-t border-solid-gray-300" />
      <span className="text-dns-14N-130 text-solid-gray-600">{label}</span>
      <div className="flex-1 border-t border-solid-gray-300" />
    </div>
  );
}
