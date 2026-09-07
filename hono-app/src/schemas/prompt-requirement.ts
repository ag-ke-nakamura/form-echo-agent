import type { INPUT_SCHEMAS } from './inputs.js'
import type { TaskId } from './task-ids.js'

/**
 * 自然文（`prompt`）が必須か（ADR-0004）。
 *
 * 構造化入力を持たない taskId は `'required'` しか書けないよう型で縛る。両方が
 * 任意になった taskId は、`prompt` も `input` も無い空のリクエストを通してしまう
 * — 表が弾くはずの状態が表自身の書き間違いで抜ける。
 *
 * 抽出系3タスクが `'required'` なのは、自然文が無ければ何も抽出できないため。
 * 構造化入力（所要時間・候補日程の一覧）は与件であって指示ではなく、それだけを
 * 送られても AI にできることが無い。
 */
export const PROMPT_REQUIREMENT = {
  'ic-card.parse-reservation': 'required',
  'meeting.parse-candidates': 'required',
  'meeting.parse-availability': 'required',
  // 参加可否表だけで成立し、「AI提案」ボタンを押すだけで送れる必要がある。
  'meeting.recommend-schedule': 'optional',
} satisfies {
  [K in TaskId]: (typeof INPUT_SCHEMAS)[K] extends null
    ? 'required'
    : 'required' | 'optional'
}

export function isPromptRequired(taskId: TaskId): boolean {
  return PROMPT_REQUIREMENT[taskId] === 'required'
}
