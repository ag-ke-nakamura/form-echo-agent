/**
 * Guardrail チェック（#43）。ADR-0001 の決定（Runtime に置く）を実装する側。
 *
 * 案A（`InvokeGuardrailChecks`）・案B（`ApplyGuardrail`）・日本固有 PII の正規表現の
 * 3つが同じ形で結果を返し、`load.ts` がまとめる。呼び出し側（`invoke-task.ts`）は
 * どの実装が動いているかを知らない。
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
   * `checkGuardrail`（`load.ts`）は日本固有 PII の正規表現（常時実行）と
   * 選択中の戦略（案A/案B）の結果を1つの `blocked` に OR で潰して返す。
   * この `source` が無いと、`findings` を見ても両者を区別できない —
   * 実際、`pii.ts` の正規表現と案Bの `regexesConfig` はどちらも同じ
   * `"my_number(regex)"` という detail を返しうる。**「案A/Bの sensitiveInformation
   * 自体がマイナンバーを検知できたか」を実測で確かめる（受け入れ条件の一つ）には、
   * ログに残った findings からこの2つを区別できる必要がある。**
   */
  source: 'code-regex' | 'strategy';
}

export interface GuardrailVerdict {
  blocked: boolean;
  findings: GuardrailFinding[];
}

/**
 * 検査の実体。案A・案B・正規表現チェックがすべてこの形を満たす。
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
