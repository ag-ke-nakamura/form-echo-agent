import type { TaskId, TaskInputMap } from "./types";

/**
 * 自然文（`prompt`）が必須か（ADR-0004）。#109（ADR-0011）で
 * `contracts/prompt-requirement.ts` から複製した。
 *
 * 構造化入力を持たない taskId は `'required'` しか書けないよう型で縛る。両方が
 * 任意になった taskId は、`prompt` も `input` も無い空のリクエストを通してしまう。
 * ADR-0017 で交通ICも構造化入力を持ったので効く先はいま無いが、縛りは残す。
 *
 * 会議の抽出系2タスクが `'required'` なのは、自然文が無ければ何も抽出できないため。
 * 構造化入力（所要時間・候補日程の一覧）は与件であって指示ではなく、それだけを
 * 送られても AI にできることが無い。
 */
export const PROMPT_REQUIREMENT = {
  /*
    フォーム主導になった（ADR-0017）。与件だけで AI にできることがあるので、
    追加指示に何も書かずに生成を押せる必要がある。
  */
  "ic-card.parse-reservation": "optional",
  "meeting.parse-candidates": "required",
  "meeting.parse-availability": "required",
  // 参加可否表だけで成立し、「AI提案」ボタンを押すだけで送れる必要がある。
  "meeting.recommend-schedule": "optional",
} satisfies {
  [K in TaskId]: TaskInputMap[K] extends undefined
    ? "required"
    : "required" | "optional";
};

export function isPromptRequired(taskId: TaskId): boolean {
  return PROMPT_REQUIREMENT[taskId] === "required";
}
