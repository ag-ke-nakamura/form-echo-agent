import type { TaskId } from './task-ids.js'

/**
 * 自然文（`prompt`）のタグ除去を掛けるか（ADR-0020）。
 *
 * 長さの上限は全 taskId に掛かる。ここが決めるのはタグ除去だけである。
 *
 * WHY 表で持つか: `playground.free-prompt` に掛けないのは、持ち込みシステムプロンプトが
 * `input` 経由でサニタイズを通らないため — 掛けたままだと**検証メッセージからだけ**
 * `<thinking>` の類が消え、「片方だけ消えた」を挙動の違いと誤読する。taskId を足す側に
 * この判断を強制するため、網羅を型で縛る。
 *
 * **`'keep'` は画面が回答本文をエスケープして描くことを前提にしている**（ADR-0020）。
 */
export const PROMPT_TAG_HANDLING = {
  'ic-card.parse-reservation': 'strip',
  'meeting.parse-candidates': 'strip',
  'meeting.parse-availability': 'strip',
  'meeting.recommend-schedule': 'strip',
  // タグを使うプロンプト技法そのものが検証の対象になる（ADR-0020）。
  'playground.free-prompt': 'keep',
} satisfies Record<TaskId, 'strip' | 'keep'>

export function stripsPromptTags(taskId: TaskId): boolean {
  return PROMPT_TAG_HANDLING[taskId] === 'strip'
}
