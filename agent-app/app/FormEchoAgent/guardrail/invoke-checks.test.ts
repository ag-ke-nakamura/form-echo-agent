import type {
  GuardrailChecksResults,
  GuardrailChecksSensitiveInformationEntityType,
} from '@aws-sdk/client-bedrock-runtime';
import { describe, expect, it } from 'vitest';
import type { GuardrailThresholds } from '../config.js';
import { verdictFromChecksResults } from './invoke-checks.js';

/**
 * 案A（`InvokeGuardrailChecks`）のしきい値との比較だけを見る。**実際に Bedrock は
 * 呼ばない** — `verdictFromChecksResults` はレスポンスを受け取って判定するだけの
 * 純関数なので、SDK クライアントを差し替える新しいテスト境界を作らずに済む。
 */

const THRESHOLDS: GuardrailThresholds = {
  promptAttack: 0.8,
  sensitiveInformation: 0.6,
  contentFilter: null,
};

/** 検査に要らない位置情報は0で埋める。 */
function sensitiveInfoEntry(
  type: GuardrailChecksSensitiveInformationEntityType,
  confidenceScore: number,
) {
  return {
    type,
    confidenceScore,
    beginOffset: 0,
    endOffset: 0,
    messageIndex: 0,
    contentIndex: 0,
  };
}

describe('verdictFromChecksResults', () => {
  it('しきい値以上のスコアはブロックする（F-02: 離散値なので >= で比較する）', () => {
    const results: GuardrailChecksResults = {
      promptAttack: {
        results: [{ category: 'JAILBREAK', severityScore: 0.8 }],
      },
    };

    const verdict = verdictFromChecksResults(results, THRESHOLDS);

    expect(verdict.blocked).toBe(true);
    expect(verdict.findings).toEqual([
      { checkType: 'promptAttack', detail: 'JAILBREAK(0.8)' },
    ]);
  });

  it('しきい値未満のスコアは通す', () => {
    const results: GuardrailChecksResults = {
      promptAttack: {
        results: [{ category: 'JAILBREAK', severityScore: 0.6 }],
      },
      sensitiveInformation: {
        results: [sensitiveInfoEntry('EMAIL', 0.4)],
      },
    };

    expect(verdictFromChecksResults(results, THRESHOLDS)).toEqual({
      blocked: false,
      findings: [],
    });
  });

  it('しきい値が null（記録のみ）のチェック種別はスコアが1.0でもブロックしない（F-06）', () => {
    const results: GuardrailChecksResults = {
      contentFilter: { results: [{ category: 'INSULTS', severityScore: 1 }] },
    };

    expect(verdictFromChecksResults(results, THRESHOLDS)).toEqual({
      blocked: false,
      findings: [],
    });
  });

  it('複数のチェック種別が同時に反応すると、両方を findings に載せる', () => {
    const results: GuardrailChecksResults = {
      promptAttack: {
        results: [{ category: 'PROMPT_INJECTION', severityScore: 1 }],
      },
      sensitiveInformation: {
        results: [sensitiveInfoEntry('US_SOCIAL_SECURITY_NUMBER', 0.6)],
      },
    };

    const verdict = verdictFromChecksResults(results, THRESHOLDS);

    expect(verdict.blocked).toBe(true);
    expect(verdict.findings).toHaveLength(2);
  });

  it('結果が空なら通す', () => {
    expect(verdictFromChecksResults({}, THRESHOLDS)).toEqual({
      blocked: false,
      findings: [],
    });
  });
});
