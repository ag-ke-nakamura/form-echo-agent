/**
 * Guardrail チェック（#43）。ADR-0001 の決定（Runtime に置く）を実装する側。
 *
 * `InvokeGuardrailChecks` と日本固有 PII の正規表現が同じ形で結果を返し、`load.ts`
 * がまとめる。呼び出し側（`invoke-task.ts`）はどの実装が動いているかを知らない。
 */

export type GuardrailDirection = 'INPUT' | 'OUTPUT';

export type GuardrailCheckType =
  | 'promptAttack'
  | 'sensitiveInformation'
  | 'contentFilter';

export interface GuardrailFinding {
  checkType: GuardrailCheckType;
  /**
   * ログにだけ出す詳細（カテゴリ名やスコアなど）。
   *
   * **画面には出さない。** どのチェックが反応したかを職員に見せると、ブロックの
   * 回避方法を教えることになる（参照ドキュメント 10.4節）。
   */
  detail: string;
  /**
   * どの層が検知したか（#43）。
   *
   * `checkGuardrail`（`load.ts`）は日本固有 PII の正規表現と `InvokeGuardrailChecks`
   * の結果を1つの `blocked` に OR で潰して返す。**この `source` が無いと、ログの
   * findings を見てもどちらが検知したのか分からない** — 経路を1本に畳んだ後
   * （ADR-0013）も、日本固有 PII 検知が効いたのか AWS 側の判定が効いたのかは
   * 区別できる必要がある（前者はマイナンバーを、後者は Prompt Attack を担う）。
   *
   * `'strategy'` は AWS 側の判定（`InvokeGuardrailChecks`。テストでは fake）を指す。
   * 案A/案Bを選べた頃の語彙だが、ログの値なので改名しない。
   */
  source: 'code-regex' | 'strategy';
}

export interface GuardrailVerdict {
  blocked: boolean;
  findings: GuardrailFinding[];
}

/**
 * 検査の実体。`InvokeGuardrailChecks`・正規表現チェック・fake がすべてこの形を満たす。
 *
 * `tools/web-search.ts` の `WebSearchBackend` と同じ考え方 — 実装の差し替えは
 * この関数の入れ替えだけで済み、呼び出し側の境界は増えない。
 */
export type GuardrailBackend = (
  text: string,
  direction: GuardrailDirection,
) => Promise<GuardrailVerdict>;

/**
 * Guardrail がこの入力または出力をブロックした。
 *
 * handler がこれを捕まえ、GUARDRAIL_BLOCKED へ写した上でセッションを破棄する
 * （F-14）。`verdict` はログ用で、応答には含めない。
 */
export class GuardrailBlockedError extends Error {
  readonly verdict: GuardrailVerdict;

  constructor(verdict: GuardrailVerdict) {
    super('Guardrail がこの入出力をブロックしました');
    this.verdict = verdict;
  }
}
