import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

/** HTTP 境界（#23 のシームその2）を回すための設定。 */
export default defineConfig({
  test: {
    setupFiles: [resolve(import.meta.dirname, 'tests/use-fake-runtime.ts')],
  },
})
