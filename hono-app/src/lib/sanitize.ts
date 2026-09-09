import { MAX_PROMPT_LENGTH } from '../schemas/index.js'

/**
 * 入力サニタイズ（参照ドキュメント 10.1節）。長さの上限と、XSS 対策の
 * 基本的なタグ除去だけを行う。
 *
 * Guardrail チェック（`InvokeGuardrailChecks`）はここではなく Runtime に置く
 * （ADR-001）。この関数が見るのは長さと形だけで、内容は判断しない。
 *
 * **タグ除去を掛けるかは taskId ごとに違う**（`stripsPromptTags`。ADR-0020）。
 * 長さの上限のほうは掛けるかどうかの選択が無い。
 */
export function sanitizePrompt(
  text: string,
  { stripTags }: { stripTags: boolean },
): string {
  if (text.length > MAX_PROMPT_LENGTH) {
    throw new PromptTooLongError(
      `入力は${MAX_PROMPT_LENGTH.toLocaleString()}文字以内にしてください。`,
    )
  }
  if (!stripTags) return text.trim()
  return text
    .replace(/<script[^>]*>.*?<\/script>/gis, '')
    .replace(/<[^>]+>/g, '')
    .trim()
}

export class PromptTooLongError extends Error {}
