/**
 * `skills/embedded.ts` を `skills/**\/SKILL.md` から作り直す。
 *
 * WHY: デプロイ済み Runtime（CodeZip）は esbuild が `main.ts` から辿れる import
 * グラフだけを束ねる。`SKILL.md` は fs 経由で読む非コードのアセットなので、
 * バンドルはおろか zip にすら含まれない（#45）。`SKILL.md` の中身を文字列として
 * import グラフに乗せることで、esbuild の通常のバンドルに混ぜる。
 *
 * `SKILL.md` を編集したら `npm run generate:skills` を実行し直すこと。
 * `skills/embedded.test.ts` が両者の一致を確かめる。
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SKILLS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'skills',
);
const DOMAINS = ['ic-card', 'meeting'] as const;

function loadDomain(domain: string): Record<string, string> {
  const tasks: Record<string, string> = {};
  for (const task of readdirSync(join(SKILLS_DIR, domain)).sort()) {
    tasks[task] = readFileSync(
      join(SKILLS_DIR, domain, task, 'SKILL.md'),
      'utf-8',
    );
  }
  return tasks;
}

const embedded: Record<string, Record<string, string>> = {};
for (const domain of DOMAINS) {
  embedded[domain] = loadDomain(domain);
}

const body = DOMAINS.map((domain) => {
  const tasks = embedded[domain];
  const taskEntries = Object.entries(tasks)
    .map(
      ([task, content]) =>
        `    ${JSON.stringify(task)}: ${JSON.stringify(content)},`,
    )
    .join('\n');
  return `  ${JSON.stringify(domain)}: {\n${taskEntries}\n  },`;
}).join('\n');

const output = `/**
 * \`SKILL.md\` の中身を import グラフに乗せるための埋め込みデータ。
 *
 * 生成物 — 手で編集しない。\`SKILL.md\` を直し、
 * \`npm run generate:skills\`（\`scripts/generate-embedded-skills.ts\`）で作り直す。
 * 両者の一致は \`skills/embedded.test.ts\` が見る。
 */
export const EMBEDDED_SKILLS: Record<string, Record<string, string>> = {
${body}
};
`;

writeFileSync(join(SKILLS_DIR, 'embedded.ts'), output);
