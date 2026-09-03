import type { INPUT_SCHEMAS } from './inputs.js';
import type { TaskId } from './task-ids.js';

/**
 * 自然文（`prompt`）が必須か（ADR-0004）。
 *
 * 構造化入力を持たない taskId は `'required'` しか書けないよう型で縛る。両方が
 * 任意になった taskId は、`prompt` も `input` も無い空のリクエストを通してしまう
 * — 表が弾くはずの状態が表自身の書き間違いで抜ける。
 *
 * 既存3タスク（抽出系）が `'required'` なのは、`prompt` を任意にした ADR-0004 が
 * 抽出系の検査を緩めないことを契約の側で担保するため。
 *
 * **`INPUT_SCHEMAS` を型としてだけ取り込む。** フロントエンドの AI チャット欄が
 * 送信ボタンの有効・無効をこの表から決めるので、値として取り込むと zod が SSG の
 * バンドルに乗る（`candidate-key.ts` と同じ理由）。
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
    : 'required' | 'optional';
};

export function isPromptRequired(taskId: TaskId): boolean {
  return PROMPT_REQUIREMENT[taskId] === 'required';
}
