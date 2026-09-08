import type { TaskId } from '../contracts/index.js';
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
 * taskId が Skill を一意に決め、その instructions を system prompt へ直接注入する
 * （ADR-0013 で `explicit` に畳んだ）。
 *
 * `skills/{domain}/{task}.ts` のデータを直接使う（ADR-0012）。以前は `SKILL.md` を
 * fs 経由で読んでいたが、デプロイ済み Runtime（CodeZip）は esbuild が import
 * グラフだけを束ねるため非コードのアセットは zip に含まれず起動時に落ちた（#45）。
 * TypeScript のデータとして直接書けば import グラフに乗るので、この問題は起きない。
 */
export function buildSystemPrompt(taskId: TaskId): string {
  return `${SKILLS[taskId]}\n\n## 基準時刻\n\n現在は ${nowInJst()}（JST）です。相対的な日付・時刻表現はこの時点を基準に解決してください。`;
}
