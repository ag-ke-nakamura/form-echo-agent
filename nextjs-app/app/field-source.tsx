/**
 * 値の出どころ。AI 由来であることを画面に出すために持つ（統制「透明性」）。
 * 職員が手を入れた時点で manual に戻り、バッジが消える。
 *
 * WHY: タブ間で共有するのはこの「印の付け方」だけに留める。フォームの状態モデル
 * そのものはタブごとに違う（交通ICはスカラーの平坦なマップ、会議候補日は配列）
 * ので、共通化すると汎用のフォーム状態モデルを発明することになる。
 */
export type FieldSource = "manual" | "ai";

/**
 * 設計書 5.2節のバッジ。文言も設計書に合わせる。
 *
 * 参加可否タブだけ「AI判定」（guest-response 設計書 6.2節）で、AI がしたことが
 * 「生成」ではなく既にある候補への「判定」だから。既定は他3タブの「AIが生成」。
 *
 * `aria-label` は設計書 7.2節の指定。バッジは値の隣に置かれるので、字面だけだと
 * 何が AI 由来なのかが読み上げでは分からない。
 */
export function AiBadge({
  label = "AIが生成",
  description = "この値はAIが生成しました",
}: {
  label?: string;
  description?: string;
} = {}) {
  return (
    <span
      aria-label={description}
      className="rounded bg-solid-blue-100 px-2 py-1 text-dns-12M-130 text-solid-blue-900"
    >
      {label}
    </span>
  );
}

/**
 * 再生成が実際にフォームへ何をしたか。AI入力アシスタントが会話ログのターンに添える。
 *
 * WHY: 「再生成は AI 由来の値だけを上書きし、手で直した値には触らない」と決めた
 * ため（#38）、職員から見ると**追加で指示したのに変わらない項目**が出る。触らな
 * かったことを言わないと、AI が指示を読み落としたのか手入力を守ったのかを区別
 * できない。`message` では代われない — あれはモデルが書いた文であって、画面が
 * 実際に反映したかどうかは保証しないため。
 *
 * 項目名の型ではなく表示用の文字列の列で持つ。守る単位がタブごとに違う（交通IC
 * は欄、候補日程は行、参加可否は日付）ので、共通の項目名の型を作ると3タブに
 * またがる汎用のフォーム状態モデルを発明することになる（#23 の Implementation
 * Decisions が避けたもの）。
 */
export type ApplyReport = {
  /** 反映した分。 */
  updated: string[];
  /** 手入力だったので触らなかった分。 */
  preserved: string[];
};

/** フォームを一切触らなかったとき。 */
export const NOTHING_APPLIED: ApplyReport = { updated: [], preserved: [] };
