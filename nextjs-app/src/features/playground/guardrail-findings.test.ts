import type { GuardrailReport } from "@/lib/api";
import { describe, expect, it } from "vitest";
import {
  guardrailDirectionLabel,
  guardrailFindingLines,
} from "./guardrail-findings";

function report(findings: GuardrailReport["findings"]): GuardrailReport {
  return { direction: "INPUT", findings };
}

describe("guardrailFindingLines", () => {
  it("スコアが何の数字かを種別から言う", () => {
    const lines = guardrailFindingLines(
      report([
        {
          checkType: "promptAttack",
          detail: "JAILBREAK(1)",
          source: "strategy",
        },
        {
          checkType: "sensitiveInformation",
          detail: "US_PASSPORT_NUMBER(0.9)",
          source: "strategy",
        },
      ]),
    );

    /*
      職員が測るのは度合いなので、数字だけでは読めない（ADR-0021）。
      `contentFilter` / `promptAttack` は `severityScore`、`sensitiveInformation` は
      `confidenceScore` で、`checkType` から一意に決まる。
    */
    expect(lines.map((line) => line.label)).toEqual([
      "プロンプト攻撃（強度）",
      "個人情報（確信度）",
    ]);
  });

  it("正規表現で当たった行はスコアの名前を騙らない", () => {
    const lines = guardrailFindingLines(
      report([
        {
          checkType: "sensitiveInformation",
          detail: "my_number(regex)",
          source: "code-regex",
        },
      ]),
    );

    // マイナンバーの検知に度合いは無い。「確信度」と書くと `(regex)` が数字の
    // 代わりに座っているように読める。
    expect(lines[0].label).toBe("個人情報（正規表現）");
    expect(lines[0].detail).toBe("my_number(regex)");
  });

  it("同じ種別が2回反応しても行の鍵がぶつからない", () => {
    const lines = guardrailFindingLines(
      report([
        {
          checkType: "sensitiveInformation",
          detail: "PASSWORD(0.9)",
          source: "strategy",
        },
        {
          checkType: "sensitiveInformation",
          detail: "AWS_SECRET_KEY(1)",
          source: "strategy",
        },
      ]),
    );

    expect(new Set(lines.map((line) => line.key)).size).toBe(2);
  });
});

describe("guardrailDirectionLabel", () => {
  it("出力側でブロックされたことを言い切る", () => {
    // 回答本文を出さないので、言わないと「モデルが何も返さなかった」に見える。
    expect(guardrailDirectionLabel("OUTPUT")).toContain("回答本文");
    expect(guardrailDirectionLabel("INPUT")).toContain("送信した内容");
  });
});
