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

export function buildSystemPrompt(taskId: TaskId): string {
  return `${loadSkill(taskId)}\n\n## 基準時刻\n\n現在は ${nowInJst()}（JST）です。相対的な日付・時刻表現はこの時点を基準に解決してください。`;
}
