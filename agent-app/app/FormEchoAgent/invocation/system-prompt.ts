import { Skill } from '@strands-agents/sdk/vended-plugins/skills';
import { resolveSkillSelectionMode } from '../config.js';
import type { TaskId } from '../contracts/index.js';
import { EMBEDDED_SKILLS } from '../skills/embedded.js';

/**
 * 明示モードの Skill 読み込み。taskId が Skill を一意に決め、`SKILL.md` の本文
 * （frontmatter を除いた instructions）を system prompt に注入する。
 *
 * ファイルを直接読まず埋め込みデータ（`skills/embedded.ts`）を使う。デプロイ済み
 * Runtime（CodeZip）は esbuild が import グラフだけを束ねるため、fs 経由で
 * `SKILL.md` を読む実装は zip に含まれず起動時に落ちる（#45）。
 */
function loadSkill(taskId: TaskId): string {
  const [domain, task] = taskId.split('.');
  return Skill.fromContent(EMBEDDED_SKILLS[domain][task]).instructions;
}

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
 * 自動モードでは Skill の instructions をここで注入しない。`AgentSkills` プラグイン
 * （`domain-agent.ts`）が `<available_skills>` のメタデータ注入と、活性化された
 * Skill の本文の受け渡しを持つ。ここで両方注入すると同じ内容を二重に持つ。
 */
export function buildSystemPrompt(taskId: TaskId): string {
  const skillContent =
    resolveSkillSelectionMode() === 'explicit'
      ? `${loadSkill(taskId)}\n\n`
      : '';
  return `${skillContent}## 基準時刻\n\n現在は ${nowInJst()}（JST）です。相対的な日付・時刻表現はこの時点を基準に解決してください。`;
}
