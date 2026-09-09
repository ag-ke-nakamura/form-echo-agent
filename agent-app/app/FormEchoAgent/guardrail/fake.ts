import type {
  GuardrailBackend,
  GuardrailDirection,
  GuardrailVerdict,
} from './types.js';

/**
 * fake が1回の検査で受け取ったもの。**Runtime が何を検査したかを外から見る窓**で、
 * `model/fake.ts` の `FakeModelCall` と同じ役目を持つ（#170）。
 */
export interface FakeGuardrailCall {
  text: string;
  direction: GuardrailDirection;
}

/**
 * Bedrock を呼ばないブロック判定。`FORMECHO_GUARDRAIL_STRATEGY=fake` で選ばれる。
 * `model/fake.ts` と同じ考え方 — テストは台本で振る舞いを決め、受け取ったものを記録する。
 *
 * 既定（台本が空）は「ブロックしない」。`InvokeGuardrailChecks` の判定ロジック
 * そのものは `invoke-checks.test.ts` がレスポンスからの写像を直接見るので、
 * invocation 境界の配線テストではここまでで足りる。
 *
 * **受け取ったテキストを記録するのは、境界越しに見えるのがブロックの1ビットだけ
 * だから**（#170）。検査対象が黙って狭まっても（出発地の連結が落ちる・追加指示が
 * 空の回に検査を省く）応答は成功のまま変わらないので、テストは緑になる。
 */
class FakeGuardrailScript {
  #verdicts: GuardrailVerdict[] = [];
  #calls: FakeGuardrailCall[] = [];

  /** 次に返す判定を積む。 */
  write(...verdicts: GuardrailVerdict[]): void {
    this.#verdicts.push(...verdicts);
  }

  /** 台本と記録を空に戻す。テストごとに呼ぶ。 */
  reset(): void {
    this.#verdicts = [];
    this.#calls = [];
  }

  /** fake が検査を頼まれた記録。古いものから並ぶ。 */
  get calls(): readonly FakeGuardrailCall[] {
    return this.#calls;
  }

  /** 次の1件を取り出し、検査を頼まれたものを記録する。無ければブロックしない判定。 */
  take(call: FakeGuardrailCall): GuardrailVerdict {
    this.#calls.push(call);
    return this.#verdicts.shift() ?? { blocked: false, findings: [] };
  }
}

export const fakeGuardrailScript = new FakeGuardrailScript();

export const fakeGuardrailCheck: GuardrailBackend = async (text, direction) =>
  fakeGuardrailScript.take({ text, direction });
