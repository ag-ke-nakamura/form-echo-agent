import type { INPUT_SCHEMAS } from './inputs.js';
import type { TaskId } from './task-ids.js';

/**
 * 自然文（`prompt`）が必須か（ADR-0004）。
 *
 * 構造化入力を持たない taskId は `'required'` しか書けないよう型で縛る。両方が
 * 任意になった taskId は、`prompt` も `input` も無い空のリクエストを通してしまう
 * — 表が弾くはずの状態が表自身の書き間違いで抜ける。ADR-0017 で交通ICも構造化入力を
 * 持ったので、この縛りが実際に効く先はいま1つも無いが、**縛りは残す** — 構造化入力を
 * 持つかどうかは ADR が動けば変わる側で、その時に空のリクエストが通るようになっては
 * いけない。
 *
 * 会議の抽出系2タスクが `'required'` なのは、自然文が無ければ何も抽出できないため。
 * 構造化入力（所要時間・候補日程の一覧）は与件であって指示ではなく、それだけを
 * 送られても AI にできることが無い。
 *
 * **`INPUT_SCHEMAS` を型としてだけ取り込む。** フロントエンドの AI チャット欄が
 * 送信ボタンの有効・無効をこの表から決めるので、値として取り込むと zod が SSG の
 * バンドルに乗る（`meeting.ts` と同じ理由）。
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
} satisfies {
  [K in TaskId]: (typeof INPUT_SCHEMAS)[K] extends null
    ? 'required'
    : 'required' | 'optional';
};

export function isPromptRequired(taskId: TaskId): boolean {
  return PROMPT_REQUIREMENT[taskId] === 'required';
}
