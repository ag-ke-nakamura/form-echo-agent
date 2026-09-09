import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

/**
 * `src/` の中を feature ごとに分けたので（ADR-0016）、テストは対象の隣から
 * 共有層を `@/` で引く。
 *
 * `@` の別名は tsconfig の `paths` にもあるが、vitest は tsconfig を見ないので
 * 同じ対応をここにも書く。**指す先が食い違うと片方だけが通る**（tsc は解決するのに
 * vitest が「Cannot find module」で落ちる、またはその逆）。プラグインで橋渡しする
 * 手もあるが、別名は1つしかなく、依存を1つ増やすほうが高く付く。
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "src"),
    },
  },
});
