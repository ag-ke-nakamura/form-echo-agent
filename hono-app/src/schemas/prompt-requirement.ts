import type { INPUT_SCHEMAS } from './inputs.js'
import type { TaskId } from './task-ids.js'

/**
 * 自然文（`prompt`）が必須か（ADR-0004）。
 *
 * 構造化入力を持たない taskId は `'required'` しか書けないよう型で縛る。両方が
 * 任意になった taskId は、`prompt` も `input` も無い空のリクエストを通してしまう
 * — 表が弾くはずの状態が表自身の書き間違いで抜ける。ADR-0017 で交通ICも構造化入力を
 * 持ったので効く先はいま無いが、縛りは残す。
 *
 * 会議の抽出系2タスクが `'required'` なのは、自然文が無ければ何も抽出できないため。
 * 構造化入力（所要時間・候補日程の一覧）は与件であって指示ではなく、それだけを
 * 送られても AI にできることが無い。
 */
export const PROMPT_REQUIREMENT = {
  /*
    フォーム主導になった（ADR-0017）。運賃の額を決める与件は職員がフォームで
    決めるので、追加指示に何も書かずに生成を押せる必要がある。
  */
  'ic-card.parse-reservation': 'optional',
  'meeting.parse-candidates': 'required',
  'meeting.parse-availability': 'required',
  // 参加可否表だけで成立し、「AI提案」ボタンを押すだけで送れる必要がある。
  'meeting.recommend-schedule': 'optional',
  /*
    検証メッセージも必須にする（ADR-0022 が ADR-0020 の「空でもよい」を改訂した）。

    WHY: 空だと user message が**空の text ブロック1つ**としてモデルへ飛ぶ。Bedrock の
    Converse はこれを `ValidationException` で弾くので、職員には原因の分からない失敗に
    しか見えない。**空でも投げる形は実機で成立しない。** 画面の送信ボタンはこの表から
    可否を引くので、`required` にすることが「空のときは送信できない」の実体になる。

    持ち込みシステムプロンプト1本だけを試したい回は、検証メッセージに一言書いて送る。
  */
  'playground.free-prompt': 'required',
} satisfies {
  [K in TaskId]: (typeof INPUT_SCHEMAS)[K] extends null
    ? 'required'
    : 'required' | 'optional'
}

export function isPromptRequired(taskId: TaskId): boolean {
  return PROMPT_REQUIREMENT[taskId] === 'required'
}
