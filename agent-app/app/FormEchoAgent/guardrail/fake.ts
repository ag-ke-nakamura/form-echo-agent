import type { GuardrailBackend, GuardrailVerdict } from './types.js';

/**
 * Bedrock を呼ばないブロック判定。`FORMECHO_GUARDRAIL_STRATEGY=fake` で選ばれる。
 * `model/fake.ts` と同じ考え方 — テストは台本で振る舞いを決める。
 *
 * 既定（台本が空）は「ブロックしない」。案A・案Bそのものの判定ロジックは
 * `invoke-checks.test.ts` / `apply-guardrail.test.ts` が SDK クライアントを
 * 差し替えて見るので、invocation 境界の配線テストではここまでで足りる。
 */
class FakeGuardrailScript {
  #verdicts: GuardrailVerdict[] = [];

  /** 次に返す判定を積む。 */
  write(...verdicts: GuardrailVerdict[]): void {
    this.#verdicts.push(...verdicts);
  }

  /** 台本を空に戻す。テストごとに呼ぶ。 */
  reset(): void {
    this.#verdicts = [];
  }

  /** 次の1件を取り出す。無ければブロックしない判定。 */
  take(): GuardrailVerdict {
    return this.#verdicts.shift() ?? { blocked: false, findings: [] };
  }
}

export const fakeGuardrailScript = new FakeGuardrailScript();

export const fakeGuardrailCheck: GuardrailBackend = async () =>
  fakeGuardrailScript.take();
