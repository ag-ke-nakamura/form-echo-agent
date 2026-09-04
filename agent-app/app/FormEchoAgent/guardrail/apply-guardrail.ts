import {
  ApplyGuardrailCommand,
  type ApplyGuardrailCommandOutput,
} from '@aws-sdk/client-bedrock-runtime';
import { resolveGuardrailResource } from '../config.js';
import { bedrockRuntimeClient } from './bedrock-runtime-client.js';
import type {
  GuardrailBackend,
  GuardrailFinding,
  GuardrailVerdict,
} from './types.js';

/**
 * 案B（`ApplyGuardrail`）。新規作成した Guardrail リソース（Classic Tier）を参照し、
 * AWS 側が判定する（ADR-032「実装方式の比較」B）。しきい値は呼び出し側の引数では
 * なくリソースの設定（`scripts/create-guardrail.ts`）が持つ。
 */

export const applyGuardrail: GuardrailBackend = async (text, direction) => {
  const { identifier, version } = resolveGuardrailResource();
  const response = await bedrockRuntimeClient().send(
    new ApplyGuardrailCommand({
      guardrailIdentifier: identifier,
      guardrailVersion: version,
      source: direction,
      content: [{ text: { text } }],
    }),
  );

  return verdictFromApplyGuardrailResponse(response);
};

/**
 * レスポンスを判定に写す。**純関数として切り出す** — SDK を叩く部分と分けることで、
 * 実際に Bedrock を呼ばずに `GUARDRAIL_INTERVENED` の解釈をテストできる
 * （`invoke-checks.ts` の `verdictFromChecksResults` と同じ考え方）。
 */
export function verdictFromApplyGuardrailResponse(
  response: ApplyGuardrailCommandOutput,
): GuardrailVerdict {
  if (response.action !== 'GUARDRAIL_INTERVENED') {
    return { blocked: false, findings: [] };
  }

  const findings: GuardrailFinding[] = [];
  for (const assessment of response.assessments ?? []) {
    for (const filter of assessment.contentPolicy?.filters ?? []) {
      if (filter.action !== 'BLOCKED') continue;
      // prompt attack は content filters の中に PROMPT_ATTACK として埋まっている
      // （F-07）。案Aの `promptAttack` と同じ種別に寄せる。
      const checkType =
        filter.type === 'PROMPT_ATTACK' ? 'promptAttack' : 'contentFilter';
      findings.push({
        checkType,
        detail: `${filter.type}(${filter.confidence})`,
      });
    }
    for (const entity of assessment.sensitiveInformationPolicy?.piiEntities ??
      []) {
      if (entity.action !== 'BLOCKED') continue;
      findings.push({
        checkType: 'sensitiveInformation',
        detail: entity.type ?? 'unknown',
      });
    }
    // カスタム正規表現（マイナンバー等、F-16）。コード側の `pii.ts` と重複しうるが、
    // どちらの方式が実際に検知したかを比較するのがこのチケットの目的の一つ。
    for (const regex of assessment.sensitiveInformationPolicy?.regexes ?? []) {
      if (regex.action !== 'BLOCKED') continue;
      findings.push({
        checkType: 'sensitiveInformation',
        detail: `${regex.name}(regex)`,
      });
    }
  }

  return { blocked: findings.length > 0, findings };
}
