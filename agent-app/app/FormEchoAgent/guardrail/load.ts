import {
  FAKE_GUARDRAIL_STRATEGY_NAME,
  resolveGuardrailStrategy,
} from '../config.js';
import { applyGuardrail } from './apply-guardrail.js';
import { fakeGuardrailCheck } from './fake.js';
import { invokeGuardrailChecks } from './invoke-checks.js';
import { checkJapanesePii } from './pii.js';
import type {
  GuardrailBackend,
  GuardrailDirection,
  GuardrailVerdict,
} from './types.js';

/** `model/load.ts` と同じ構え。設定を見て実物を組む場所であり、判断はここに閉じる。 */
const STRATEGIES: Record<
  ReturnType<typeof resolveGuardrailStrategy>,
  GuardrailBackend
> = {
  'invoke-checks': invokeGuardrailChecks,
  'apply-guardrail': applyGuardrail,
  [FAKE_GUARDRAIL_STRATEGY_NAME]: fakeGuardrailCheck,
};

/**
 * この Runtime が使う Guardrail 全体。`invoke-task.ts` が入力（自然文）と出力
 * （Structured Output のパース結果）の両方でこれを呼ぶ。
 *
 * **日本固有 PII の正規表現は方式（案A/案B）によらず常に走る**（F-03・F-16）。
 * `InvokeGuardrailChecks` にマイナンバー相当の型が無く、`ApplyGuardrail` の
 * `regexesConfig` もツール関連フィールド（出力側）は見ないため、コード側にも
 * 要る。
 */
export async function checkGuardrail(
  text: string,
  direction: GuardrailDirection,
): Promise<GuardrailVerdict> {
  const strategy = STRATEGIES[resolveGuardrailStrategy()];
  const [pii, strategyVerdict] = await Promise.all([
    checkJapanesePii(text, direction),
    strategy(text, direction),
  ]);
  return {
    blocked: pii.blocked || strategyVerdict.blocked,
    findings: [...pii.findings, ...strategyVerdict.findings],
  };
}
