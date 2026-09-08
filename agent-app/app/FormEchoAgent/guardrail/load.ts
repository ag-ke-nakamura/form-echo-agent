import { isGuardrailFake } from '../config.js';
import { fakeGuardrailCheck } from './fake.js';
import { invokeGuardrailChecks } from './invoke-checks.js';
import { checkJapanesePii } from './pii.js';
import type {
  GuardrailBackend,
  GuardrailDirection,
  GuardrailVerdict,
} from './types.js';

/**
 * この Runtime が使う Guardrail 全体。`invoke-task.ts` が入力（自然文）と出力
 * （Structured Output のパース結果）の両方でこれを呼ぶ。
 *
 * 経路は `InvokeGuardrailChecks`（AWS 側の判定）と日本固有 PII の正規表現の2つで、
 * **どちらも常時有効**（ADR-0013）。両方を並行に呼び、1つでもブロックすれば
 * 全体もブロックする。`InvokeGuardrailChecks` はマイナンバーを検知できず
 * （#44 の実測で 0/8）、正規表現は日本語の Prompt Attack を見ないので、片方だけでは
 * 足りない。
 *
 * `FORMECHO_GUARDRAIL_STRATEGY=fake` のときは `InvokeGuardrailChecks` の呼び先を
 * fake に差し替える（AWS を呼ばない）。正規表現チェックは純関数で決定的なので
 * 差し替えの対象にしない。
 */
export async function checkGuardrail(
  text: string,
  direction: GuardrailDirection,
): Promise<GuardrailVerdict> {
  const strategy: GuardrailBackend = isGuardrailFake()
    ? fakeGuardrailCheck
    : invokeGuardrailChecks;

  const results = await Promise.all([
    checkJapanesePii(text, direction),
    strategy(text, direction),
  ]);
  return {
    blocked: results.some((result) => result.blocked),
    findings: results.flatMap((result) => result.findings),
  };
}
