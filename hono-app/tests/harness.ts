import type {
  AiErrorResponse,
  AiTaskSuccessResponse,
} from '@contracts/index.js'
import { app } from '../src/index.js'
import type { FakeRuntimeTurn } from '../src/lib/fake-runtime.js'
import { fakeRuntimeScript } from '../src/lib/fake-runtime.js'
import type { RuntimeInvocation } from '../src/lib/runtime-transport.js'

/** 台本が既定で返す usage。応答にそのまま出るので、テストが期待値として引く。 */
export { NO_USAGE } from '../src/lib/fake-runtime.js'

/**
 * HTTP 境界を回すための足場（#23 のシームその2）。
 *
 * ここに置くのは呼び出しの手間を省く道具だけで、判断は持たない。fake の
 * Runtime クライアント（`src/lib/fake-runtime.ts`）と違い、こちらは配られない。
 */

const ENDPOINT = 'http://localhost/api/ai/tasks'

/**
 * テストが使うセッション ID。
 *
 * BFF は UUID しか受け付けないので固定の UUID を1つ持つ。発行される側
 * （リクエストに載せない場合）は Runtime が受け取った値から見る。
 */
export const SESSION_ID = '11111111-2222-4333-8444-555555555555'

/** Runtime が成功応答を返す1手。`result` の中身はテストが決める。 */
export function runtimeReturns(result: unknown): FakeRuntimeTurn {
  return { kind: 'succeed', result }
}

/** 境界を1回叩く。`payload` は JSON として送られる。 */
export function postTask(payload: unknown): Promise<Response> {
  return postRawTask(JSON.stringify(payload))
}

/** JSON になっていない本文を送る経路。 */
export async function postRawTask(body: string): Promise<Response> {
  return await app.request(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  })
}

export async function expectSuccess(
  response: Response,
): Promise<AiTaskSuccessResponse> {
  const body: unknown = await response.json()
  if (typeof body === 'object' && body !== null && 'error' in body) {
    const { error } = body as AiErrorResponse
    throw new Error(
      `成功を期待しましたが ${error.code} でした: ${error.message}`,
    )
  }
  return body as AiTaskSuccessResponse
}

export async function expectError(
  response: Response,
): Promise<AiErrorResponse['error']> {
  const body: unknown = await response.json()
  if (typeof body !== 'object' || body === null || !('error' in body)) {
    throw new Error(`失敗を期待しましたが成功しました: ${JSON.stringify(body)}`)
  }
  return (body as AiErrorResponse).error
}

/** Runtime が受け取った最後の1回。1回も呼ばれていなければ落とす。 */
export function lastInvocation(): RuntimeInvocation {
  const invocation = fakeRuntimeScript.calls.at(-1)
  if (invocation === undefined) {
    throw new Error('Runtime が1回も呼ばれていません')
  }
  return invocation
}
