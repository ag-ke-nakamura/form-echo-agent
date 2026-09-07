import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EMBEDDED_SKILLS } from './embedded.js';

/**
 * `skills/embedded.ts` は生成物（`npm run generate:skills`）。`SKILL.md` を
 * 編集して生成し直すのを忘れると、デプロイ済み Runtime だけが古い Skill を
 * 読む状態になる（#45）。ここで両者の一致を機械的に見る。
 */
const SKILLS_DIR = dirname(fileURLToPath(import.meta.url));

describe('skills/embedded.ts は SKILL.md と一致する', () => {
  for (const domain of readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)) {
    for (const task of readdirSync(join(SKILLS_DIR, domain)).sort()) {
      it(`${domain}/${task}`, () => {
        const onDisk = readFileSync(
          join(SKILLS_DIR, domain, task, 'SKILL.md'),
          'utf-8',
        );
        expect(EMBEDDED_SKILLS[domain]?.[task]).toBe(onDisk);
      });
    }
  }
});
