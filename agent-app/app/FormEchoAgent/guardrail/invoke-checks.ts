import {
  BedrockRuntimeClient,
  type GuardrailChecksResults,
  InvokeGuardrailChecksCommand,
} from '@aws-sdk/client-bedrock-runtime';
import {
  AWS_REGION,
  type GuardrailThresholds,
  resolveGuardrailThresholds,
} from '../config.js';
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
/** F-03: 日本固有の識別子はここに無い。`pii.ts` の正規表現が別に見る。 */
const SENSITIVE_INFORMATION_ENTITIES = [
  'ADDRESS',
  'AGE',
  'EMAIL',
  'NAME',
  'PHONE',
  'URL',
  'USERNAME',
  'US_SOCIAL_SECURITY_NUMBER',
  'CREDIT_DEBIT_CARD_NUMBER',
] as const;

let client: BedrockRuntimeClient | undefined;
function guardrailChecksClient(): BedrockRuntimeClient {
  client ??= new BedrockRuntimeClient({ region: AWS_REGION });
  return client;
}

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
  const response = await guardrailChecksClient().send(
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
