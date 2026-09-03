import type { TaskId } from "@contracts/index.js";
import type { ReactNode } from "react";

/**
 * 非AI経路のフォームを囲む `<section>` の id。taskId から導く。
 *
 * WHY: 3タブは同時に描かれている（切り替えは `hidden`）ので、id は画面全体で
 * 一意でなければならない。taskId は出力契約の許可リストで一意が保証されている
 * ので、画面側で別に採番して `AiChatPanel` まで配り歩くより取り違えようがない。
 */
export function formSectionId(taskId: TaskId): string {
  return `${taskId}-form`;
}

/**
 * 非AI経路のフォームを囲む枠。
 *
 * WHY: 3タブで見た目が同じなだけなら各タブに書いておけばよいが、ここは
 * `AiChatPanel` の導線が飛ぶ先でもある。タブごとに書き写すと、タブを1つ足す
 * たびに id・`tabIndex`・スクロール位置・枠の見た目を3ファイルにまたがって
 * 揃える作業になる（中身のフォームはタブごとに違うままでよい）。
 */
export function FormSection({
  taskId,
  children,
}: {
  taskId: TaskId;
  children: ReactNode;
}) {
  return (
    <section
      id={formSectionId(taskId)}
      /*
        リンクで飛んだときに読み上げの位置もここへ移すため、フォーカスを
        受けられるようにする。`tabIndex={-1}` なので Tab の順路には入らない。
      */
      tabIndex={-1}
      className="scroll-mt-6 rounded-lg border border-black/10 p-6 dark:border-white/15"
    >
      {children}
    </section>
  );
}
