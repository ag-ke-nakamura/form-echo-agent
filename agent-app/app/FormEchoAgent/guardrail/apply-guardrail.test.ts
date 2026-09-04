import type { ApplyGuardrailCommandOutput } from '@aws-sdk/client-bedrock-runtime';
import { describe, expect, it } from 'vitest';
import { verdictFromApplyGuardrailResponse } from './apply-guardrail.js';

/**
 * 案B（`ApplyGuardrail`）の判定への写し方だけを見る。**実際に Bedrock は
 * 呼ばない**（`invoke-checks.test.ts` と同じ考え方）。
 */

function response(
  overrides: Partial<ApplyGuardrailCommandOutput>,
): ApplyGuardrailCommandOutput {
  return {
    action: 'GUARDRAIL_INTERVENED',
    assessments: [],
    usage: {},
    ...overrides,
  } as ApplyGuardrailCommandOutput;
}

describe('verdictFromApplyGuardrailResponse', () => {
  it('action が NONE なら通す', () => {
    expect(
      verdictFromApplyGuardrailResponse(response({ action: 'NONE' })),
    ).toEqual({ blocked: false, findings: [] });
  });

  it('content filter が BLOCKED を返すとブロックする', () => {
    const verdict = verdictFromApplyGuardrailResponse(
      response({
        assessments: [
          {
            contentPolicy: {
              filters: [
                {
                  type: 'INSULTS',
                  confidence: 'HIGH',
                  action: 'BLOCKED',
                },
              ],
            },
          },
        ],
      }),
    );

    expect(verdict.blocked).toBe(true);
    expect(verdict.findings).toEqual([
      { checkType: 'contentFilter', detail: 'INSULTS(HIGH)' },
    ]);
  });

  it('PROMPT_ATTACK は content filter ではなく promptAttack の種別になる（F-07）', () => {
    const verdict = verdictFromApplyGuardrailResponse(
      response({
        assessments: [
          {
            contentPolicy: {
              filters: [
                {
                  type: 'PROMPT_ATTACK',
                  confidence: 'HIGH',
                  action: 'BLOCKED',
                },
              ],
            },
          },
        ],
      }),
    );

    expect(verdict.findings).toEqual([
      { checkType: 'promptAttack', detail: 'PROMPT_ATTACK(HIGH)' },
    ]);
  });

  it('sensitive information のカスタム正規表現がブロックされると検知する（F-16）', () => {
    const verdict = verdictFromApplyGuardrailResponse(
      response({
        assessments: [
          {
            sensitiveInformationPolicy: {
              piiEntities: [],
              regexes: [
                {
                  name: 'my_number',
                  regex: String.raw`\d{4}-?\d{4}-?\d{4}`,
                  action: 'BLOCKED',
                  match: '1234-5678-9012',
                },
              ],
            },
          },
        ],
      }),
    );

    expect(verdict.blocked).toBe(true);
    expect(verdict.findings).toEqual([
      { checkType: 'sensitiveInformation', detail: 'my_number(regex)' },
    ]);
  });

  it('BLOCKED でない（ANONYMIZED 等の）検知は findings に載せない', () => {
    const verdict = verdictFromApplyGuardrailResponse(
      response({
        assessments: [
          {
            sensitiveInformationPolicy: {
              piiEntities: [
                { type: 'EMAIL', action: 'ANONYMIZED', match: 'a@example.com' },
              ],
              regexes: [],
            },
          },
        ],
      }),
    );

    expect(verdict).toEqual({ blocked: false, findings: [] });
  });
});
