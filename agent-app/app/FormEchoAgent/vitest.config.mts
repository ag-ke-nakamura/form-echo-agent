import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

/**
 * invocation 境界（#23 のシームその1）を回すための設定。
 *
 * `zod` の別名は tsconfig の `paths` にもあるが、vitest は tsconfig を見ないので
 * 同じ対応をここにも書く。**必要なのは `contracts/` の解決経路のため。**
 * `contracts` はパッケージ内の symlink だが、vite は実体のパス
 * （リポジトリルートの `contracts/`）へ解決するので、そこから `node_modules` を
 * 辿ると `zod` に届かない（`nextjs-app/vitest.config.mts` と同じ事情）。
 */
export default defineConfig({
  resolve: {
    alias: {
      zod: resolve(import.meta.dirname, 'node_modules/zod'),
    },
  },
  test: {
    setupFiles: [resolve(import.meta.dirname, 'tests/use-fake-model.ts')],
  },
});
