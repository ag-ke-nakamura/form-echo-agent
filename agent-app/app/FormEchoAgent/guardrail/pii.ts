import type { GuardrailBackend, GuardrailVerdict } from './types.js';

/**
 * マイナンバー（個人番号、12桁）を検知する正規表現（F-03）。
 *
 * `InvokeGuardrailChecks` の `sensitiveInformation` が持つ31種の PII 型は米国・
 * 英国・カナダ・汎用のもので、日本の個人番号に対応する型が無い（#44 の実測でも
 * マイナンバーは 0/8）。**このためコード側の正規表現が恒久的に必要**で、常時有効に
 * してある（ADR-0013）。
 *
 * ハイフン区切り（1234-5678-9012）と連続表記の両方を拾う。
 */
export const MY_NUMBER_PATTERN = String.raw`\d{4}-?\d{4}-?\d{4}`;

const myNumberRegex = new RegExp(MY_NUMBER_PATTERN);

/**
 * 常に走る正規表現チェック。`GuardrailBackend` と同じ形にして `load.ts` が
 * `InvokeGuardrailChecks` と横に並べられるようにする。
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
