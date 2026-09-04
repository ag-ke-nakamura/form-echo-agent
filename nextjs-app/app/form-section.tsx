import type { TaskId } from "@contracts/index.js";
import type { ReactNode } from "react";

/**
 * 非AI経路のフォームを囲む `<section>` の id。taskId から導く。
 *
 * WHY: 3タブは同時に描かれている（切り替えは `hidden`）ので、id は画面全体で
 * 一意でなければならない。taskId は出力契約の許可リストで一意が保証されている
 * ので、画面側で別に採番して `AiAssistant` まで配り歩くより取り違えようがない。
 */
export function formSectionId(taskId: TaskId): string {
  return `${taskId}-form`;
}

/**
 * 非AI経路のフォームを囲む枠。
 *
 * WHY: 3タブで見た目が同じなだけなら各タブに書いておけばよいが、ここは
 * `AiAssistant` の導線が飛ぶ先でもある。タブごとに書き写すと、タブを1つ足す
 * たびに id・`tabIndex`・スクロール位置を3ファイルにまたがって揃える作業になる
 * （中身のフォームはタブごとに違うままでよい）。
 *
 * 枠を持たないのは設計書に合わせたため。区切り線が既に境界を引いているので、
 * さらに囲うと非AI経路が「AI の下にぶら下がった別枠」に見える。
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
      className="scroll-mt-6"
    >
      {children}
    </section>
  );
}
