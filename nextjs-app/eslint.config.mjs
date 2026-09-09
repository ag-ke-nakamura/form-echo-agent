import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/**
 * feature の境界（ADR-0016）を規約ではなくルールで守る。境界を跨ぐ import は
 * `@/` 始まりと決めたので判定は import 文の**文字列だけ**で足りる — パスを解決する
 * `import/no-restricted-paths` を採ると TypeScript 用のリゾルバまで要り、依存が2つ増える。
 *
 * `**\/features/**` が捕まえるのは `@/features/...` の側だけである。**相対で隣の
 * feature へ登った `../../ic-card/x` は文字列に `features` を持たない** ので、
 * 「feature の外へ登ること自体」を別に禁じる。何段登れば外に出るかは自分の深さで
 * 決まるので、深さごとにブロックを分ける（後のブロックが前を上書きするので、
 * 共通のパターンも各ブロックで書き直す）。
 *
 * 深さの列挙は今ある構成に合わせてあるため、`src/features/**` 全体に「3段以上登る
 * import」の禁止を敷いて底を張る。深さ5以上を作るとここが誤検知するが、**誤検知は
 * 落ちて分かる**（深さの取りこぼしは静かに通る）。
 *
 * **glob を打ち間違えたルールは何にもマッチせず静かに通る。** 発火することは
 * `eslint.config.test.mts` が確かめている。
 */
const FROM_FEATURE =
  "feature の外を直接 import しない（ADR-0016）。他 feature と共有したいものは @/components か @/lib へ出す。同じ feature 内は相対 import で書く。";
const FROM_SHARED =
  "共有層は feature とルート層に依存しない（ADR-0016）。依存は feature → 共有層の一方向に保つ。";

/** `group` のどれかに当たる import を禁じる `rules` オブジェクト。 */
const banImports = (message, ...group) => ({
  "no-restricted-imports": ["error", { patterns: [{ group, message }] }],
});

const featureBoundaries = defineConfig([
  {
    // 深さを問わない底。3段登れば、今ある構成のどこからでも features/ の外に出る。
    files: ["src/features/**"],
    rules: banImports(
      FROM_FEATURE,
      "**/features/**",
      "**/app/**",
      "../../../**",
    ),
  },
  {
    // feature 直下（`ic-card/x.ts`）。1段でも登れば features/ に出る。
    files: ["src/features/*/*"],
    rules: banImports(FROM_FEATURE, "**/features/**", "**/app/**", "../**"),
  },
  {
    // 会議 feature の画面の下（`meeting/candidates/x.ts`）。`../shared/` は
    // 同じ feature 内なので通す。
    files: ["src/features/*/*/*"],
    rules: banImports(FROM_FEATURE, "**/features/**", "**/app/**", "../../**"),
  },
  {
    files: ["src/components/**", "src/lib/**"],
    rules: banImports(FROM_SHARED, "**/features/**", "**/app/**"),
  },
]);

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  ...featureBoundaries,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
