import {
  FREE_PROMPT_TASK_ID,
  freePromptInputSchema,
  type TaskId,
} from '../contracts/index.js';
import { SKILLS } from '../skills/registry.js';

/**
 * 相対的な日付・時刻表現（「来月15日」「3泊4日」「今から3時間後」）を解決する基準時刻。
 *
 * WHY: モデルは現在時刻を持たないので、与えなければ学習データ由来の日付を
 * 使ってしまう。JST 固定なのは、利用者が国内で働く職員だから。
 * `sv-SE` ロケールは YYYY-MM-DD HH:mm を返す。
 *
 * **日付だけでなく時刻まで渡す。** 日付だけだと「今から3時間後」のような表現に
 * 対して、モデルは現在時刻を知らないと言って空の結果を返す（Skill が「読み取れない
 * 場合は空配列」と決めているため、契約違反にはならず黙って何も出ない）。時刻を
 * 取得するツールを渡す手もあるが、ここは Skill が既に持っている基準時刻の仕組みで
 * 足りる — モデルの判断を挟まないので、ツールを呼ばずに諦める失敗の余地が無い。
 */
function nowInJst(): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Tokyo',
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date());
}

/**
 * system prompt の素材。**taskId が Skill を一意に決める**（ADR-0013 で `explicit` に
 * 畳んだ）。
 *
 * `skills/{domain}/{task}.ts` のデータを直接使う（ADR-0012）。以前は `SKILL.md` を
 * fs 経由で読んでいたが、デプロイ済み Runtime（CodeZip）は esbuild が import
 * グラフだけを束ねるため非コードのアセットは zip に含まれず起動時に落ちた（#45）。
 * TypeScript のデータとして直接書けば import グラフに乗るので、この問題は起きない。
 *
 * **`playground.free-prompt` だけは Skill を持たず、職員が持ち込んだ文が素材になる**
 * （ADR-0020）。我々が足すのは下の基準時刻の付記1つだけで、**Skill を一切混ぜない**
 * — 混ぜた瞬間、職員が見ているのは自分が書いた文の効きではなくなる。
 */
function systemPromptSource(taskId: TaskId, input: unknown): string {
  if (taskId === FREE_PROMPT_TASK_ID) {
    // 検査済みの `input` しか渡らない（`inspectedInputStrings` と同じく `parse`）。
    return freePromptInputSchema.parse(input).system_prompt;
  }
  return SKILLS[taskId];
}

/**
 * モデルへ渡す system prompt の全文（**実効システムプロンプト**）と、その素材。
 *
 * 基準時刻の付記はどの taskId にも足す。プロンプト検証でも足すのは、他タブとの比較で
 * 「基準時刻がある状態のモデル」を揃えるため（ADR-0020）。足したことは隠さない。
 *
 * **素材を別に返すのは、会話履歴を続けてよいかの判定に使うため**（ADR-0020、#204）。
 * 全文どうしを比べると基準時刻が分単位で動くので、同じ Skill・同じ持ち込みシステム
 * プロンプトのまま数分後に送った追い質問まで履歴が切れる。
 */
export function buildSystemPrompt(
  taskId: TaskId,
  input: unknown,
): { promptSource: string; systemPrompt: string } {
  const promptSource = systemPromptSource(taskId, input);
  return {
    promptSource,
    systemPrompt: `${promptSource}\n\n## 基準時刻\n\n現在は ${nowInJst()}（JST）です。相対的な日付・時刻表現はこの時点を基準に解決してください。`,
  };
}
