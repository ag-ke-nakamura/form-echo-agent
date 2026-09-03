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
