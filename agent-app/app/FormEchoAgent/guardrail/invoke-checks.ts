import {
  type GuardrailChecksResults,
  InvokeGuardrailChecksCommand,
} from '@aws-sdk/client-bedrock-runtime';
import {
  type GuardrailThresholds,
  resolveGuardrailThresholds,
} from '../config.js';
import { bedrockRuntimeClient } from './bedrock-runtime-client.js';
import type {
  GuardrailBackend,
  GuardrailCheckType,
  GuardrailFinding,
  GuardrailVerdict,
} from './types.js';

/**
 * 案A（`InvokeGuardrailChecks`）。リソース不要で、離散スコアを自前のしきい値と
 * 比べる（ADR-032「実装方式の比較」A）。
 *
 * `@aws-sdk/client-bedrock-runtime` は 3.1069.0 以降が必要（F-08。それ以前は
 * `InvokeGuardrailChecksCommand` が存在しない）。
 */

/** 評価するカテゴリ・エンティティを固定で列挙する。しきい値だけが調整対象になる。 */
const CONTENT_FILTER_CATEGORIES = [
  'HATE',
  'INSULTS',
  'MISCONDUCT',
  'SEXUAL',
  'VIOLENCE',
] as const;
const PROMPT_ATTACK_CATEGORIES = [
  'JAILBREAK',
  'PROMPT_INJECTION',
  'PROMPT_LEAKAGE',
] as const;
/**
 * F-03: 日本固有の識別子（マイナンバー等）はここに無い。`pii.ts` の正規表現が別に見る。
 *
 * **`ADDRESS` / `NAME` / `PHONE` / `EMAIL` 等の汎用カテゴリはここに含めない。**
 * 日本語でも高い confidence で検知できる（F-06: 「NAME 1.0 / ADDRESS 1.0」）のが
 * 逆に仇になる — `ic-card.parse-reservation` の仕事は行き先という**住所そのもの**を
 * 抽出することで、正常な入力（「大阪出張」）ですら `ADDRESS(1)` として検知され、
 * ブロックしてしまう（実機で確認した実際の誤検知）。
 *
 * 残すのは、この4タスクのどれの正常な出力にも本来含まれ得ない、資格情報・
 * 金融/政府発行の識別子だけにする。
 */
const SENSITIVE_INFORMATION_ENTITIES = [
  'US_SOCIAL_SECURITY_NUMBER',
  'CREDIT_DEBIT_CARD_NUMBER',
  'US_PASSPORT_NUMBER',
  'DRIVER_ID',
  'AWS_ACCESS_KEY',
  'AWS_SECRET_KEY',
  'PASSWORD',
  'PIN',
] as const;

function findingsAbove(
  checkType: GuardrailCheckType,
  entries: { label: string; score: number }[],
  threshold: number | null,
): GuardrailFinding[] {
  if (threshold === null) return [];
  return entries
    .filter((entry) => entry.score >= threshold)
    .map((entry) => ({ checkType, detail: `${entry.label}(${entry.score})` }));
}

/**
 * レスポンスをしきい値と比べて判定に写す。**純関数として切り出す** — SDK を叩く
 * 部分と分けることで、実際に Bedrock を呼ばずにしきい値の境界（F-02 の離散値）を
 * テストできる。
 */
export function verdictFromChecksResults(
  results: GuardrailChecksResults,
  thresholds: GuardrailThresholds,
): GuardrailVerdict {
  const findings = [
    ...findingsAbove(
      'contentFilter',
      (results.contentFilter?.results ?? []).map((r) => ({
        label: r.category ?? 'unknown',
        score: r.severityScore ?? 0,
      })),
      thresholds.contentFilter,
    ),
    ...findingsAbove(
      'promptAttack',
      (results.promptAttack?.results ?? []).map((r) => ({
        label: r.category ?? 'unknown',
        score: r.severityScore ?? 0,
      })),
      thresholds.promptAttack,
    ),
    ...findingsAbove(
      'sensitiveInformation',
      (results.sensitiveInformation?.results ?? []).map((r) => ({
        label: r.type ?? 'unknown',
        score: r.confidenceScore ?? 0,
      })),
      thresholds.sensitiveInformation,
    ),
  ];

  return { blocked: findings.length > 0, findings };
}

export const invokeGuardrailChecks: GuardrailBackend = async (
  text,
  direction,
) => {
  const response = await bedrockRuntimeClient().send(
    new InvokeGuardrailChecksCommand({
      checks: {
        contentFilter: {
          categories: CONTENT_FILTER_CATEGORIES.map((category) => ({
            category,
          })),
        },
        promptAttack: {
          categories: PROMPT_ATTACK_CATEGORIES.map((category) => ({
            category,
          })),
        },
        sensitiveInformation: {
          entities: SENSITIVE_INFORMATION_ENTITIES.map((type) => ({ type })),
        },
      },
      // 役割は入出力どちらを評価しているかを表すだけで、案Aは role ごとの
      // 挙動の違いを持たない。
      messages: [
        {
          role: direction === 'INPUT' ? 'user' : 'assistant',
          content: [{ text }],
        },
      ],
    }),
  );

  return verdictFromChecksResults(
    response.results ?? {},
    resolveGuardrailThresholds(),
  );
};
