import { isGuardrailFake, resolveGuardrailLayers } from '../config.js';
import { applyGuardrail } from './apply-guardrail.js';
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
 * 案A・案B・案C（日本固有 PII の正規表現）はそれぞれ独立に ON/OFF できる
 * （`resolveGuardrailLayers`）。1つの排他的な選択にしないのは、「案Aだけ／
 * 案Bだけでマイナンバーを検知できるか」を確かめる実測（#43 の受け入れ条件）で、
 * 常時 ON の層が他の層の結果を覆い隠さないようにするため。有効な層をすべて
 * 並行に呼び、1つでもブロックすれば全体もブロックする。
 *
 * `FORMECHO_GUARDRAIL_STRATEGY=fake` のときは案A・案Bの呼び先を fake に
 * 差し替える（AWS を呼ばない）。案Cは純関数で決定的なので差し替えの対象にしない。
 */
export async function checkGuardrail(
  text: string,
  direction: GuardrailDirection,
): Promise<GuardrailVerdict> {
  const layers = resolveGuardrailLayers();
  const fake = isGuardrailFake();
  const invokeChecksBackend: GuardrailBackend = fake
    ? fakeGuardrailCheck
    : invokeGuardrailChecks;
  const applyGuardrailBackend: GuardrailBackend = fake
    ? fakeGuardrailCheck
    : applyGuardrail;

  const checks: Promise<GuardrailVerdict>[] = [];
  if (layers.customRegex) checks.push(checkJapanesePii(text, direction));
  if (layers.invokeChecks) checks.push(invokeChecksBackend(text, direction));
  if (layers.applyGuardrail)
    checks.push(applyGuardrailBackend(text, direction));

  const results = await Promise.all(checks);
  return {
    blocked: results.some((result) => result.blocked),
    findings: results.flatMap((result) => result.findings),
  };
}
