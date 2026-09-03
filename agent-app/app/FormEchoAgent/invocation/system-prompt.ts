import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TaskId } from '../contracts/index.js';

/**
 * skills/ を指す基準になるパッケージルート。
 *
 * WHY: このモジュールは tsx で実行される `.ts` としても `dist/` 配下の `.js`
 * としても動く。import.meta.url からの相対位置が両者で1階層ずれるので、
 * package.json のあるところまで遡ってパッケージルートを決める。
 */
function findPackageRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  while (!existsSync(join(dir, 'package.json'))) {
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(
        'package.json が見つからず skills/ の位置を決められません',
      );
    }
    dir = parent;
  }
  return dir;
}

const PACKAGE_ROOT = findPackageRoot();

/**
 * 明示モードの Skill 読み込み。taskId が Skill を一意に決め、`SKILL.md` の本文を
 * そのまま system prompt に注入する。ドメインエージェントに選ばせる自動モードは
 * `AgentSkills` プラグインを入れるチケットで足す。
 */
function loadSkill(taskId: TaskId): string {
  const [domain, task] = taskId.split('.');
  return readFileSync(
    join(PACKAGE_ROOT, 'skills', domain, task, 'SKILL.md'),
    'utf8',
  );
}

/**
 * 相対的な日付表現（「来月15日」「3泊4日」）を解決する基準日。
 *
 * WHY: モデルは現在時刻を持たないので、与えなければ学習データ由来の日付を
 * 使ってしまう。JST 固定なのは、利用者が国内で働く職員だから。
 * `sv-SE` ロケールは YYYY-MM-DD を返す。
 */
function todayInJst(): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(
    new Date(),
  );
}

export function buildSystemPrompt(taskId: TaskId): string {
  return `${loadSkill(taskId)}\n\n## 基準日\n\n今日は ${todayInJst()}（JST）です。相対的な日付表現はこの日を基準に解決してください。`;
}
