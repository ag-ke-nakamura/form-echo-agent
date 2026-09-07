import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

/** invocation 境界（#23 のシームその1）を回すための設定。 */
export default defineConfig({
  test: {
    setupFiles: [resolve(import.meta.dirname, 'tests/use-fake-model.ts')],
  },
});
