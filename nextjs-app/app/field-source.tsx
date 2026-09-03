/**
 * 値の出どころ。AI 由来であることを画面に出すために持つ（統制「透明性」）。
 * 職員が手を入れた時点で manual に戻り、バッジが消える。
 *
 * WHY: タブ間で共有するのはこの「印の付け方」だけに留める。フォームの状態モデル
 * そのものはタブごとに違う（交通ICはスカラーの平坦なマップ、会議候補日は配列）
 * ので、共通化すると汎用のフォーム状態モデルを発明することになる。
 */
export type FieldSource = "manual" | "ai";

export function AiBadge() {
  return (
    <span className="rounded-full bg-blue-600/10 px-2 py-0.5 text-[11px] font-medium text-blue-700 dark:bg-blue-400/15 dark:text-blue-300">
      AI が入力
    </span>
  );
}

/**
 * 再生成が実際にフォームへ何をしたか。AI チャット欄が会話ログのターンに添える。
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
