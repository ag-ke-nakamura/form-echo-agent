/**
 * Guardrail チェック（#43）。ADR-0001 の決定（Runtime に置く）を実装する側。
 *
 * `InvokeGuardrailChecks` と日本固有 PII の正規表現が同じ形で結果を返し、`load.ts`
 * がまとめる。呼び出し側（`invoke-task.ts`）はどの実装が動いているかを知らない。
 */

/*
  向き・種別・findings の形は出力契約が持つ（`contracts/api.ts`）。**応答に載る欄に
  なったため**（ADR-0021。`playground.free-prompt` に限って画面へ出す）で、ここに
  複製を置くと、載せる側と作る側で形がずれても誰も気付かない。

  `source` の値がなぜ `'strategy'` なのかは契約側に書けないのでここに残す — 案A/案B を
  選べた頃の語彙で、経路を1本に畳んだ後（ADR-0013）もログの値なので改名しない。
  日本固有 PII 検知が効いたのか AWS 側の判定が効いたのかは、1つの `blocked` に OR で
  潰した後も区別できる必要がある（前者はマイナンバーを、後者は Prompt Attack を担う）。
*/
import type {
  GuardrailCheckType,
  GuardrailDirection,
  GuardrailFinding,
} from '../contracts/index.js';

export type { GuardrailCheckType, GuardrailDirection, GuardrailFinding };

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
 * （F-14）。
 *
 * **`direction` を持つのは、ブロックがどちらで起きたかが投げた側にしか無いため**
 * （ADR-0021 で `playground.free-prompt` の画面に出る欄になった）。handler から
 * 見ると入力側と出力側は同じ例外で、区別する手掛かりが他に無い。
 */
export class GuardrailBlockedError extends Error {
  readonly verdict: GuardrailVerdict;
  readonly direction: GuardrailDirection;

  constructor(verdict: GuardrailVerdict, direction: GuardrailDirection) {
    super('Guardrail がこの入出力をブロックしました');
    this.verdict = verdict;
    this.direction = direction;
  }
}
