import { randomUUID } from 'node:crypto'
import type {
  AiErrorCode,
  AiErrorResponse,
  TaskInputProblem,
} from '@contracts/index.js'
import { checkTaskInput, isTaskId, sessionIdSchema } from '@contracts/index.js'
import { type Context, Hono } from 'hono'
import { cors } from 'hono/cors'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { ALLOWED_ORIGINS, PORT, resolveRuntimeClientName } from './config.js'
import { invokeRuntime } from './lib/runtime-client.js'
import { PromptTooLongError, sanitizePrompt } from './lib/sanitize.js'
import { authenticate } from './middleware/auth.js'

// 設定が指す Runtime クライアントが存在することを起動時に確かめる。ここで確かめないと、
// 綴りを間違えた `FORMECHO_RUNTIME_CLIENT` に気付けるのが最初のリクエストの時で、
// しかも失敗が RUNTIME_UNAVAILABLE として出るため Runtime 障害と区別が付かない。
resolveRuntimeClientName()

/** エラーコードから HTTP ステータスへの写像。判断を1箇所に集める。 */
const STATUS_BY_CODE: Record<AiErrorCode, ContentfulStatusCode> = {
  INVALID_INPUT: 400,
  INVALID_TASK_ID: 400,
  PARSE_FAILED: 502,
  TIMEOUT: 504,
  RUNTIME_UNAVAILABLE: 503,
  INTERNAL_ERROR: 500,
}

/**
 * この BFF の HTTP 境界（#23 のシームその2）。名前付きで export するのは、
 * テストが `app.request()` でプロセスを立てずに叩けるようにするため。
 */
export const app = new Hono()

app.use('/api/*', cors({ origin: ALLOWED_ORIGINS }))
app.use('/api/*', authenticate)

app.get('/', (c) => c.text('FormEcho BFF'))

app.post('/api/ai/tasks', async (c) => {
  const body: unknown = await c.req.json().catch(() => null)
  if (typeof body !== 'object' || body === null) {
    return fail(c, 'INVALID_INPUT', 'リクエストボディが JSON ではありません。')
  }

  const { taskId, prompt, sessionId, input } = body as Record<string, unknown>

  // taskId の照合を prompt の検査より先に置く。許可されていない taskId は
  // 内容を見るまでもなく拒否する（参照ドキュメント 10.2節）。
  if (!isTaskId(taskId)) {
    return fail(c, 'INVALID_TASK_ID', '不正なタスクIDです。')
  }
  if (prompt !== undefined && prompt !== null && typeof prompt !== 'string') {
    return fail(c, 'INVALID_INPUT', 'prompt は文字列である必要があります。')
  }
  // 空白だけの入力は「書かれなかった」として扱う。契約が見るのは書かれたか
  // どうかだけなので、この正規化は画面から来る値を知っているこの層の仕事になる。
  const promptGiven = typeof prompt === 'string' && prompt.trim() !== ''

  /**
   * 自然文と構造化入力の必須性・適合の判断は契約の表に委ねる（ADR-0004）。
   *
   * この層で分岐を書き写すと、契約が taskId の必須性を変えたときに BFF だけが
   * 古い判断のまま残る。構造化入力はサニタイズも Guardrail チェックも通さないので、
   * ここで弾くことが Runtime へ届く前の唯一の関門になる。
   */
  const checked = checkTaskInput(taskId, {
    prompt: promptGiven ? prompt : undefined,
    input,
  })
  if (!checked.ok) {
    return fail(
      c,
      'INVALID_INPUT',
      INPUT_PROBLEM_MESSAGES[checked.problem.kind],
    )
  }
  const structuredInput = checked.input

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

  let sanitized: string | undefined
  if (promptGiven) {
    try {
      sanitized = sanitizePrompt(prompt)
    } catch (error) {
      if (error instanceof PromptTooLongError) {
        return fail(c, 'INVALID_INPUT', error.message)
      }
      throw error
    }
    // サニタイズで空になった場合、自然文が必須ならそれは入力が無いのと同じ。
    // 任意のタスクでは「指示なし」として通す（構造化入力だけで成立するため）。
    // サニタイズで空になった場合、自然文が必須なら入力が無いのと同じ。判断は
    // ここでも表に返す（`prompt` を落として通るかどうかを訊く）。
    if (sanitized === '') {
      if (!checkTaskInput(taskId, { input }).ok) {
        return fail(c, 'INVALID_INPUT', 'サニタイズ後の入力が空になりました。')
      }
      sanitized = undefined
    }
  }

  const outcome = await invokeRuntime({
    taskId,
    prompt: sanitized,
    sessionId: resolvedSessionId,
    input: structuredInput,
  })

  if (!outcome.ok) {
    return fail(c, outcome.code, outcome.message)
  }
  return c.json(outcome.response)
})

/** 入力契約に落ちた理由から画面へ出す文言への写像。判断そのものは契約側にある。 */
const INPUT_PROBLEM_MESSAGES: Record<TaskInputProblem['kind'], string> = {
  PROMPT_REQUIRED: '入力が空です。',
  INPUT_NOT_ACCEPTED: 'このタスクは構造化入力を受け付けません。',
  INPUT_INVALID: '構造化入力が入力契約に適合しません。',
}

function fail(c: Context, code: AiErrorCode, message: string) {
  const payload: AiErrorResponse = { error: { code, message } }
  return c.json(payload, STATUS_BY_CODE[code])
}

export default { port: PORT, fetch: app.fetch }
