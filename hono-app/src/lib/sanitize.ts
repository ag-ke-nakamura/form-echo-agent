import { MAX_PROMPT_LENGTH } from '@contracts/index.js'

/**
 * 入力サニタイズ（参照ドキュメント 10.1節）。長さの上限と、XSS 対策の
 * 基本的なタグ除去だけを行う。
 *
 * Guardrail チェック（`InvokeGuardrailChecks`）はここではなく Runtime に置く
 * （ADR-001）。この関数が見るのは長さと形だけで、内容は判断しない。
 */
export function sanitizePrompt(text: string): string {
  if (text.length > MAX_PROMPT_LENGTH) {
    throw new PromptTooLongError(
      `入力は${MAX_PROMPT_LENGTH.toLocaleString()}文字以内にしてください。`,
    )
  }
  return text
    .replace(/<script[^>]*>.*?<\/script>/gis, '')
    .replace(/<[^>]+>/g, '')
    .trim()
}

export class PromptTooLongError extends Error {}
