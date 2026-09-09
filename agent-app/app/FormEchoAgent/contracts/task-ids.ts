/**
 * BFF が受け付ける taskId の許可リスト。Runtime はここから
 * ドメイン部を切り出してドメインエージェントを選ぶ。
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
] as const;

export type TaskId = (typeof ALLOWED_TASK_IDS)[number];

/**
 * 職員が system prompt を持ち込む taskId（ADR-0020）。**この1つだけが例外の側**で、
 * Skill を持たず、Structured Output も通らない。
 *
 * 定数として名前を付けるのは、この taskId かどうかで分岐する箇所（Skill の解決・
 * user message の組み立て・出力の経路）が綴り違いで黙って既存の側へ落ちないように
 * するため。
 */
export const FREE_PROMPT_TASK_ID = 'playground.free-prompt';

export function isTaskId(value: unknown): value is TaskId {
  return (
    typeof value === 'string' &&
    (ALLOWED_TASK_IDS as readonly string[]).includes(value)
  );
}

/** ドメインエージェントを一意に指す名前。taskId のドット前の部分と一致する。 */
export type Domain = 'ic-card' | 'meeting' | 'playground';

export function domainOf(taskId: TaskId): Domain {
  return taskId.split('.')[0] as Domain;
}
