import type { GuardrailReport } from "@/lib/api";

/**
 * Guardrail がブロックしたときの表示語彙（ADR-0021、#203）。
 *
 * **プロンプト検証タブ専用で、`lib/` には置かない。** 共有の置き場所へ出すと他4タブ
 * から引けてしまい、ADR-0009 を改訂した範囲（`playground.free-prompt` の1点）を超える。
 *
 * 文言そのものが UI 側の関心事なのは `error-guidance.ts` と同じ（ADR-0002）。
 */

type GuardrailFinding = GuardrailReport["findings"][number];

/** チェック種別の表示名。 */
const CHECK_TYPE_LABELS: Record<GuardrailFinding["checkType"], string> = {
  contentFilter: "有害表現",
  promptAttack: "プロンプト攻撃",
  sensitiveInformation: "個人情報",
};

/**
 * どちらを検査していて反応したか。**出力側だったことを言い切る必要がある**
 * （ADR-0021）— 回答本文は出さないので、言わないと職員には「モデルが何も返さな
 * かった」ように見え、プロンプトを直す手掛かりにならない。
 */
const DIRECTION_LABELS: Record<GuardrailReport["direction"], string> = {
  INPUT: "送信した内容（持ち込みシステムプロンプトと検証メッセージ）",
  OUTPUT: "AI の回答本文（本文は表示しません）",
};

export function guardrailDirectionLabel(
  direction: GuardrailReport["direction"],
): string {
  return DIRECTION_LABELS[direction];
}

/**
 * `detail` に括弧で付いている数字が何の数字かを言う。
 *
 * **職員が測るのは度合いなので、数字だけ出しても読めない**（ADR-0021）。API が返す
 * のは `contentFilter` / `promptAttack` が `severityScore`、`sensitiveInformation` が
 * `confidenceScore` で、`checkType` から一意に決まる。
 *
 * **日本固有 PII の正規表現（マイナンバー）にはスコアが無い** — 当たったか当たらな
 * かったかしかない。ここを「確信度」と書くと、`my_number(regex)` の `(regex)` が
 * 数字の代わりに座っているように読める。
 */
function scoreKind(finding: GuardrailFinding): string {
  if (finding.source === "code-regex") return "正規表現";
  return finding.checkType === "sensitiveInformation" ? "確信度" : "強度";
}

/** 画面へ出す1行。 */
export type GuardrailFindingLine = {
  key: string;
  /** チェック種別と、`detail` の数字が何の数字か。 */
  label: string;
  /**
   * 反応したカテゴリまたは PII 型とスコア（`JAILBREAK(1)` / `my_number(regex)`）。
   *
   * **Runtime が組んだ文字列をそのまま出す。** しきい値を持つのは Runtime なので、
   * 画面が分解して数値を再解釈する立場に無い。
   */
  detail: string;
};

export function guardrailFindingLines(
  report: GuardrailReport,
): GuardrailFindingLine[] {
  return report.findings.map((finding) => ({
    // 同じ種別が複数の理由で反応する（PII 型が2つ当たる）ので、種別だけでは足りない。
    key: `${finding.checkType}:${finding.detail}`,
    label: `${CHECK_TYPE_LABELS[finding.checkType]}（${scoreKind(finding)}）`,
    detail: finding.detail,
  }));
}
