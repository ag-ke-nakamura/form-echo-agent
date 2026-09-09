import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

/**
 * feature 境界の禁止線（ADR-0016 / #158）が**発火すること**を見る。
 *
 * `pnpm run lint` が言えるのは「違反が無い木で通った」ことだけで、glob を打ち
 * 間違えたルールは何にもマッチせず静かに通る。だから木を lint するのではなく、
 * 違反そのものを ESLint に食わせて、報告されることを確かめる。
 *
 * ESLint は既に devDependency なので、コマンドもツールも増えない。
 */
const eslint = new ESLint();

/** `filePath` にこの中身があったとして、禁止線が挙げるメッセージ。 */
async function boundaryErrors(filePath: string, code: string) {
  const [result] = await eslint.lintText(code, { filePath });
  return result.messages.filter((m) => m.ruleId === "no-restricted-imports");
}

describe("feature 境界", () => {
  it("feature から他 feature への import を禁じる（@/ 始まり）", async () => {
    const errors = await boundaryErrors(
      "src/features/meeting/candidates/candidates-form.ts",
      'import { x } from "@/features/ic-card/reservation-form";\n',
    );
    expect(errors).toHaveLength(1);
  });

  it("feature から他 feature への import を禁じる（相対で登ったもの）", async () => {
    const errors = await boundaryErrors(
      "src/features/meeting/candidates/candidates-form.ts",
      'import { x } from "../../ic-card/reservation-form";\n',
    );
    expect(errors).toHaveLength(1);
  });

  it("feature 直下から他 feature への import を禁じる（@/ 始まり）", async () => {
    const errors = await boundaryErrors(
      "src/features/ic-card/reservation-form.ts",
      'import { x } from "@/features/meeting/shared/meeting-info";\n',
    );
    expect(errors).toHaveLength(1);
  });

  it("feature 直下から隣の feature への相対 import を禁じる", async () => {
    const errors = await boundaryErrors(
      "src/features/ic-card/reservation-form.ts",
      'import { x } from "../meeting/shared/meeting-info";\n',
    );
    expect(errors).toHaveLength(1);
  });

  it("同じ feature 内の相対 import は通す", async () => {
    const errors = await boundaryErrors(
      "src/features/meeting/candidates/candidates-form.ts",
      'import { x } from "../shared/meeting-info";\nimport { y } from "./candidate-calendar";\n',
    );
    expect(errors).toHaveLength(0);
  });

  it.for([
    "src/features/ic-card/reservation-form.ts",
    "src/features/meeting/candidates/candidates-form.ts",
    "src/features/meeting/candidates/components/slot-grid.ts",
  ])("feature からルート層への import を禁じる（%s）", async (filePath) => {
    const errors = await boundaryErrors(
      filePath,
      'import { x } from "@/app/form-echo-tabs";\n',
    );
    expect(errors).toHaveLength(1);
  });

  /**
   * 相対で登るほうの禁止は自分の深さで決まるので、深さの列挙は今ある構成に
   * 合わせてある。1段深いところが線の外に落ちていないことを見る。
   */
  it("画面の下にもう1段掘っても線が残る", async () => {
    const deeper = "src/features/meeting/candidates/components/slot-grid.ts";
    expect(
      await boundaryErrors(
        deeper,
        'import { x } from "@/features/ic-card/reservation-form";\n',
      ),
    ).toHaveLength(1);
    expect(
      await boundaryErrors(
        deeper,
        'import { x } from "../../../ic-card/reservation-form";\n',
      ),
    ).toHaveLength(1);
    expect(
      await boundaryErrors(
        deeper,
        'import { x } from "../../shared/meeting-info";\n',
      ),
    ).toHaveLength(0);
  });

  it("共有層から feature への import を禁じる", async () => {
    const errors = await boundaryErrors(
      "src/components/form-section.tsx",
      'import { x } from "@/features/ic-card/reservation-form";\n',
    );
    expect(errors).toHaveLength(1);
  });

  it("共有層からルート層への import を禁じる", async () => {
    const errors = await boundaryErrors(
      "src/lib/api.ts",
      'import { x } from "@/app/form-echo-tabs";\n',
    );
    expect(errors).toHaveLength(1);
  });

  it("共有層から共有層への import は通す（`hono-app` も app 扱いしない）", async () => {
    const errors = await boundaryErrors(
      "src/lib/sources.ts",
      'import type { AppType } from "hono-app";\nimport { x } from "@/lib/api";\n',
    );
    expect(errors).toHaveLength(0);
  });

  it("ルート層から feature への import は通す", async () => {
    const errors = await boundaryErrors(
      "src/app/form-echo-tabs.tsx",
      'import { x } from "@/features/ic-card/reservation-panel";\n',
    );
    expect(errors).toHaveLength(0);
  });
});
