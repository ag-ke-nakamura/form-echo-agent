/**
 * BFF が受け付ける taskId の許可リスト。Runtime はここから
 * ドメイン部を切り出してドメインエージェントを選ぶ。
 *
 * WHY: 載せるのはこの検証環境が実際に処理できるものだけに限る。未実装の taskId を
 * 許可リストに入れると BFF を通過してから Runtime で落ち、どの層の問題かが
 * 分かりにくくなる。参照ドキュメント 10.2節が挙げる4機能はこれで全部揃った。
 */
export const ALLOWED_TASK_IDS = [
  'ic-card.parse-reservation',
  'meeting.parse-candidates',
  'meeting.parse-availability',
  'meeting.recommend-schedule',
] as const;

export type TaskId = (typeof ALLOWED_TASK_IDS)[number];

export function isTaskId(value: unknown): value is TaskId {
  return (
    typeof value === 'string' &&
    (ALLOWED_TASK_IDS as readonly string[]).includes(value)
  );
}

/** ドメインエージェントを一意に指す名前。taskId のドット前の部分と一致する。 */
export type Domain = 'ic-card' | 'meeting';

export function domainOf(taskId: TaskId): Domain {
  return taskId.split('.')[0] as Domain;
}
