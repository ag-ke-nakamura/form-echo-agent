/**
 * BFF が受け付ける taskId の許可リスト。
 *
 * WHY: 載せるのはこの検証環境が実際に処理できるものだけに限る。未実装の taskId を
 * 許可リストに入れると BFF を通過してから Runtime で落ち、どの層の問題かが
 * 分かりにくくなる。参照ドキュメント 10.2節が挙げる4機能はこれで全部揃った。
 * 5つめ（プロンプト検証）は参照ドキュメントに無い、我々が足した検証用の画面である。
 */
export const ALLOWED_TASK_IDS = [
  'ic-card.parse-reservation',
  'meeting.parse-candidates',
  'meeting.parse-availability',
  'meeting.recommend-schedule',
  'playground.free-prompt',
] as const

export type TaskId = (typeof ALLOWED_TASK_IDS)[number]

export function isTaskId(value: unknown): value is TaskId {
  return (
    typeof value === 'string' &&
    (ALLOWED_TASK_IDS as readonly string[]).includes(value)
  )
}
