import type { GuardrailBackend, GuardrailVerdict } from './types.js';

/**
 * マイナンバー（個人番号、12桁）を検知する正規表現（F-03）。
 *
 * `InvokeGuardrailChecks` の `sensitiveInformation` が持つ31種の PII 型は米国・
 * 英国・カナダ・汎用のもので、日本の個人番号に対応する型が無い。`ApplyGuardrail`
 * の `regexesConfig` はカスタム正規表現を持てるが、ツール関連フィールド
 * （`toolUse.input` 等）を評価しないため Structured Output の出力側には効かない
 * （F-16）。**このためコード側の正規表現は方式（案A/案B）によらず恒久的に必要**
 * になる。
 *
 * ハイフン区切り（1234-5678-9012）と連続表記の両方を拾う。Guardrail リソースの
 * `regexesConfig` にも同じパターン文字列を登録する（`agent-app/infra/lib/guardrail-config.ts`、
 * ADR-0010）— lookaround（`(?=)` / `(?<=)`）は向こうでは使えないので、ここでも使わない。
 */
export const MY_NUMBER_PATTERN = String.raw`\d{4}-?\d{4}-?\d{4}`;

const myNumberRegex = new RegExp(MY_NUMBER_PATTERN);

/**
 * 実装方式によらず常に走る正規表現チェック。`GuardrailBackend` と同じ形にして
 * `load.ts` が案A・案Bと横に並べられるようにする。
 */
export const checkJapanesePii: GuardrailBackend = async (text) => {
  const matched = myNumberRegex.test(text);
  const verdict: GuardrailVerdict = {
    blocked: matched,
    findings: matched
      ? [
          {
            checkType: 'sensitiveInformation',
            detail: 'my_number(regex)',
            source: 'code-regex',
          },
        ]
      : [],
  };
  return verdict;
};
