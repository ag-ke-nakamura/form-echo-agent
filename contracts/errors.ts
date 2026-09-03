/**
 * BFF がフロントエンドへ返すエラーコード。
 *
 * ここに置くのはコードだけで、画面に出す文言は置かない（ADR-002:
 * 表示メタデータは UI 側の関心事）。文言は参照ドキュメント 9.3節の表に従って
 * フロントエンドがコードから引く。
 *
 * WHY: Guardrail チェックのブロック（GUARDRAIL_BLOCKED）は MVP では発生しない
 * ため、まだ載せない。Guardrail を実装するチケットで追加する。
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
