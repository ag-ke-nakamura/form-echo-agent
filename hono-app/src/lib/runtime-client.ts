import type {
  AiErrorCode,
  AiTaskSuccessResponse,
  TaskId,
} from '@contracts/index.js'
import { isAiErrorCode, OUTPUT_SCHEMAS } from '@contracts/index.js'
import { RUNTIME_TIMEOUT_MS, RUNTIME_URL } from '../config.js'

export type RuntimeOutcome =
  | { ok: true; response: AiTaskSuccessResponse }
  | { ok: false; code: AiErrorCode; message: string }

/** AgentCore Runtime がセッションの振り分けに使うヘッダー。無いと 400 を返す。 */
const SESSION_HEADER = 'X-Amzn-Bedrock-AgentCore-Runtime-Session-Id'

/**
 * ローカルの `agentcore dev` が立てた Runtime を叩く。
 *
 * デプロイ済み Runtime を SigV4 で叩く経路は未実装。切り替えは呼び出し側ではなく
 * このモジュールの中で行う（BFF の他の部分は宛先を知らない）。
 */
export async function invokeRuntime(
  taskId: TaskId,
  prompt: string,
  sessionId: string,
): Promise<RuntimeOutcome> {
  let response: Response
  try {
    response = await fetch(`${RUNTIME_URL}/invocations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        [SESSION_HEADER]: sessionId,
      },
      body: JSON.stringify({ taskId, prompt, sessionId }),
      signal: AbortSignal.timeout(RUNTIME_TIMEOUT_MS),
    })
  } catch (error) {
    // TimeoutError と、接続そのものが張れない場合（Runtime が落ちている）を分ける。
    // 画面の案内が「もう一度お試しください」と「手動で入力してください」で違うため。
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      return {
        ok: false,
        code: 'TIMEOUT',
        message: 'Runtime が時間内に応答しませんでした。',
      }
    }
    return {
      ok: false,
      code: 'RUNTIME_UNAVAILABLE',
      message: 'Runtime に到達できませんでした。',
    }
  }

  const body: unknown = await response.json().catch(() => null)

  if (!response.ok) {
    if (response.status >= 500) {
      return {
        ok: false,
        code: 'RUNTIME_UNAVAILABLE',
        message: `Runtime が ${response.status} を返しました。`,
      }
    }
    // 4xx は Runtime がこの BFF の投げ方を拒否したということで、利用者ではなく
    // 我々の側の不整合。利用者に再入力を促しても直らないので INTERNAL_ERROR にする。
    return {
      ok: false,
      code: 'INTERNAL_ERROR',
      message: `Runtime がリクエストを受け付けませんでした（${response.status}）。`,
    }
  }

  if (isRuntimeError(body)) {
    return { ok: false, code: body.error.code, message: body.error.message }
  }

  const parsed = runtimeSuccessShape(body)
  if (!parsed) {
    return {
      ok: false,
      code: 'PARSE_FAILED',
      message: 'Runtime のレスポンスが想定の形ではありませんでした。',
    }
  }

  // 出力契約は Runtime 側でも検査済みだが、BFF でも同じスキーマで見る。
  // 3者が同じ contracts/ を参照していることを実際に効かせるのがこの検証環境の目的。
  const result = OUTPUT_SCHEMAS[taskId].safeParse(parsed.result)
  if (!result.success) {
    return {
      ok: false,
      code: 'PARSE_FAILED',
      message: 'Runtime の出力が出力契約に適合しませんでした。',
    }
  }

  return {
    ok: true,
    response: {
      sessionId: parsed.sessionId,
      result: result.data,
      usage: parsed.usage,
    },
  }
}

/**
 * `code` が出力契約のエラーコードであることまで確かめる。
 *
 * WHY: 型アサーションだけで通すと、契約に無いコード（Guardrail のチケットで
 * 足される GUARDRAIL_BLOCKED や、Runtime と BFF の版がずれた場合）がそのまま
 * 流れる。呼び出し側の `STATUS_BY_CODE[code]` が undefined になり、Hono は
 * 200 を返す — ブラウザにはエラー本文の入った成功応答が届いてしまう。
 */
function isRuntimeError(
  body: unknown,
): body is { error: { code: AiErrorCode; message: string } } {
  if (typeof body !== 'object' || body === null || !('error' in body))
    return false
  const error = (body as { error: unknown }).error
  if (typeof error !== 'object' || error === null || !('code' in error))
    return false
  return isAiErrorCode((error as { code: unknown }).code)
}

function runtimeSuccessShape(body: unknown): AiTaskSuccessResponse | null {
  if (typeof body !== 'object' || body === null) return null
  const candidate = body as Partial<AiTaskSuccessResponse>
  if (typeof candidate.sessionId !== 'string') return null
  if (candidate.result === undefined || candidate.usage === undefined)
    return null
  return candidate as AiTaskSuccessResponse
}
