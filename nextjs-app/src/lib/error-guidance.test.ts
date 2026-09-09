import { describe, expect, it } from "vitest";
import type { AiErrorCode } from "./api";
import { errorGuidanceFor } from "./error-guidance";

/**
 * 失敗時の案内の表（`error-guidance.ts`）。
 *
 * この表は**どのタブで起きた失敗かを知らない**まま、非AI経路へ導くかどうかを言う。
 * プロンプト検証タブには非AI経路が無い（ADR-0020）ので、呼び出し側がそれを渡す形に
 * なった。ここで守るのは**渡された側の案内に非AI経路が漏れないこと**である。
 */

/** 画面が受け取りうるエラーコード。契約側（`AppType`）に対して型で照合する。 */
const CODES = [
  "INVALID_INPUT",
  "INVALID_TASK_ID",
  "PARSE_FAILED",
  "TIMEOUT",
  "RUNTIME_UNAVAILABLE",
  "GUARDRAIL_BLOCKED",
  "INTERNAL_ERROR",
] as const satisfies readonly AiErrorCode[];

const WITH_PATH = { hasNonAiPath: true };
const WITHOUT_PATH = { hasNonAiPath: false };

describe("非AI経路を持つタブ", () => {
  it("Runtime 障害では非AI経路へ導く", () => {
    const guidance = errorGuidanceFor("RUNTIME_UNAVAILABLE", WITH_PATH);

    expect(guidance.offersNonAiPath).toBe(true);
    expect(guidance.nextStep).toContain("フォーム");
  });

  it("タイムアウトと Runtime 障害で案内が違う", () => {
    // もう一度送れば直るのかどうかが、赤い枠の中から読めること。
    const timeout = errorGuidanceFor("TIMEOUT", WITH_PATH);
    const unavailable = errorGuidanceFor("RUNTIME_UNAVAILABLE", WITH_PATH);

    expect(timeout.summary).not.toBe(unavailable.summary);
    expect(timeout.nextStep).not.toBe(unavailable.nextStep);
    expect(timeout.offersNonAiPath).toBe(false);
  });
});

describe("非AI経路を持たない画面", () => {
  it.each(CODES)("%s の案内が非AI経路へ誘導しない", (code) => {
    const guidance = errorGuidanceFor(code, WITHOUT_PATH);

    expect(guidance.offersNonAiPath).toBe(false);
    expect(guidance.nextStep).not.toContain("フォーム");
    expect(guidance.nextStep).not.toContain("手動");
  });

  it("それでもタイムアウトと Runtime 障害の案内は違う", () => {
    const timeout = errorGuidanceFor("TIMEOUT", WITHOUT_PATH);
    const unavailable = errorGuidanceFor("RUNTIME_UNAVAILABLE", WITHOUT_PATH);

    expect(timeout.summary).not.toBe(unavailable.summary);
    expect(timeout.nextStep).not.toBe(unavailable.nextStep);
  });

  it("書いた内容が残っていることを言う（送り直せる案内の前提）", () => {
    expect(errorGuidanceFor("TIMEOUT", WITHOUT_PATH).nextStep).toContain(
      "残って",
    );
  });
});

it("契約に無いコードは INTERNAL_ERROR の案内に寄せる", () => {
  // BFF と画面の版がずれると未知のコードが届く。素引きだと中身の無い赤い枠が出る。
  expect(errorGuidanceFor("SOMETHING_NEW", WITH_PATH)).toEqual(
    errorGuidanceFor("INTERNAL_ERROR", WITH_PATH),
  );
  expect(errorGuidanceFor("SOMETHING_NEW", WITHOUT_PATH)).toEqual(
    errorGuidanceFor("INTERNAL_ERROR", WITHOUT_PATH),
  );
});
