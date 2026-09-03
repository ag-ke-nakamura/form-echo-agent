import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

/**
 * HTTP 境界（#23 のシームその2）を回すための設定。
 *
 * 別名は tsconfig の `paths` にもあるが、vitest は tsconfig を見ないので同じ対応を
 * ここにも書く。`zod` が要るのは `@contracts/*` の実体がリポジトリルートの
 * `contracts/` にあり、そこから辿れる `node_modules` が存在しないため
 * （`agent-app` / `nextjs-app` の vitest 設定と同じ事情）。
 */
export default defineConfig({
  resolve: {
    alias: {
      '@contracts': resolve(import.meta.dirname, '../contracts'),
      zod: resolve(import.meta.dirname, 'node_modules/zod'),
    },
  },
  test: {
    setupFiles: [resolve(import.meta.dirname, 'tests/use-fake-runtime.ts')],
  },
})
