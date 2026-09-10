/**
 * BFF がフロントエンドへ返すエラーコード。
 *
 * ここに置くのはコードだけで、画面に出す文言は置かない（ADR-002:
 * 表示メタデータは UI 側の関心事）。文言は参照ドキュメント 9.3節の表に従って
 * フロントエンドがコードから引く。
 */
export const AI_ERROR_CODES = [
  /** 入力が長すぎる、prompt が空、リクエストの形が違う */
  'INVALID_INPUT',
  /** 許可リストにない taskId */
  'INVALID_TASK_ID',
  /** Structured Output が出力契約に適合しなかった */
  'PARSE_FAILED',
  /** Runtime が時間内に応答しなかった */
  'TIMEOUT',
  /** Runtime に到達できない、または 5xx を返した */
  'RUNTIME_UNAVAILABLE',
  /**
   * Guardrail が入力または出力をブロックした（#43）。
   *
   * どのチェック種別が反応したか（プロンプトインジェクション・個人情報等）は
   * 画面に出さない。詳細を出すとブロックの回避方法を教えることになる
   * （参照ドキュメント 10.4節、`docs/adr/0009-guardrail-block-message-wording.md`）。
   *
   * **例外は `playground.free-prompt` の1点だけ**（ADR-0021）。あのタブでは職員の
   * 仕事がプロンプトを直すことなので、二値では直した効果を測れない。応答の
   * `error.guardrail` に findings が載る。
   */
  'GUARDRAIL_BLOCKED',
  /** 上のどれにも当てはまらない失敗 */
  'INTERNAL_ERROR',
] as const;

export type AiErrorCode = (typeof AI_ERROR_CODES)[number];

export function isAiErrorCode(value: unknown): value is AiErrorCode {
  return (
    typeof value === 'string' &&
    (AI_ERROR_CODES as readonly string[]).includes(value)
  );
}
