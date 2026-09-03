import { randomUUID } from 'node:crypto'
import type { AiErrorCode, AiErrorResponse } from '@contracts/index.js'
import { isTaskId, sessionIdSchema } from '@contracts/index.js'
import { type Context, Hono } from 'hono'
import { cors } from 'hono/cors'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { ALLOWED_ORIGINS, PORT } from './config.js'
import { invokeRuntime } from './lib/runtime-client.js'
import { PromptTooLongError, sanitizePrompt } from './lib/sanitize.js'
import { authenticate } from './middleware/auth.js'

/** エラーコードから HTTP ステータスへの写像。判断を1箇所に集める。 */
const STATUS_BY_CODE: Record<AiErrorCode, ContentfulStatusCode> = {
  INVALID_INPUT: 400,
  INVALID_TASK_ID: 400,
  PARSE_FAILED: 502,
  TIMEOUT: 504,
  RUNTIME_UNAVAILABLE: 503,
  INTERNAL_ERROR: 500,
}

const app = new Hono()

app.use('/api/*', cors({ origin: ALLOWED_ORIGINS }))
app.use('/api/*', authenticate)

app.get('/', (c) => c.text('FormEcho BFF'))

app.post('/api/ai/tasks', async (c) => {
  const body: unknown = await c.req.json().catch(() => null)
  if (typeof body !== 'object' || body === null) {
    return fail(c, 'INVALID_INPUT', 'リクエストボディが JSON ではありません。')
  }

  const { taskId, prompt, sessionId } = body as Record<string, unknown>

  // taskId の照合を prompt の検査より先に置く。許可されていない taskId は
  // 内容を見るまでもなく拒否する（参照ドキュメント 10.2節）。
  if (!isTaskId(taskId)) {
    return fail(c, 'INVALID_TASK_ID', '不正なタスクIDです。')
  }
  if (typeof prompt !== 'string' || prompt.trim() === '') {
    return fail(c, 'INVALID_INPUT', '入力が空です。')
  }
  // 省略時はここで発行する。受け取った場合も UUID であることを確かめてから通す
  // （どちらも36文字なので、AgentCore のセッション ID の下限33文字を満たす）。
  let resolvedSessionId: string
  if (sessionId === undefined || sessionId === null) {
    resolvedSessionId = randomUUID()
  } else {
    const parsed = sessionIdSchema.safeParse(sessionId)
    if (!parsed.success) {
      return fail(c, 'INVALID_INPUT', 'sessionId の形式が不正です。')
    }
    resolvedSessionId = parsed.data
  }

  let sanitized: string
  try {
    sanitized = sanitizePrompt(prompt)
  } catch (error) {
    if (error instanceof PromptTooLongError) {
      return fail(c, 'INVALID_INPUT', error.message)
    }
    throw error
  }
  if (sanitized === '') {
    return fail(c, 'INVALID_INPUT', 'サニタイズ後の入力が空になりました。')
  }

  const outcome = await invokeRuntime(taskId, sanitized, resolvedSessionId)

  if (!outcome.ok) {
    return fail(c, outcome.code, outcome.message)
  }
  return c.json(outcome.response)
})

function fail(c: Context, code: AiErrorCode, message: string) {
  const payload: AiErrorResponse = { error: { code, message } }
  return c.json(payload, STATUS_BY_CODE[code])
}

export default { port: PORT, fetch: app.fetch }
