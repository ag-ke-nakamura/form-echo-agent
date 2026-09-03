import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

/**
 * 参加可否表のモック生成器（#58 のシーム3）を回すための設定。
 *
 * `@contracts/*` の別名は tsconfig の `paths` にもあるが、vitest は tsconfig を
 * 見ないので同じ対応をここにも書く。プラグインで橋渡しする手もあるが、別名は
 * 2つしかなく、依存を1つ増やすほうが高く付く。
 */
export default defineConfig({
  resolve: {
    alias: {
      "@contracts": resolve(import.meta.dirname, "../contracts"),
      "@": resolve(import.meta.dirname, "."),
    },
  },
});
