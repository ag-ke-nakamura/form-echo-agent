import type { TaskId } from '@contracts/index.js'
import {
  FAKE_RUNTIME_CLIENT_NAME,
  RUNTIME_TIMEOUT_MS,
  RUNTIME_URL,
  resolveRuntimeClientName,
} from '../config.js'
import { fakeRuntimeTransport } from './fake-runtime.js'

/**
 * Runtime へ渡す1回分。`prompt` と `input` のどちらが必要かは taskId ごとに違う
 * （ADR-0004）ので、両方を任意にして表の判断を呼び出し側に残す。
 */
export interface RuntimeInvocation {
  taskId: TaskId
  prompt?: string
  sessionId: string
  /** 入力契約で検査済みの構造化入力。持たない taskId では undefined。 */
  input?: unknown
}

/**
 * Runtime との通信だけを担う層。設定 `FORMECHO_RUNTIME_CLIENT` が言う
 * 「Runtime クライアント」の実体はこれで、**返ってきたものの解釈は含まない**。
 *
 * WHY: 差し替えの境界をここに置く。応答の解釈（エラーコードへの写像と出力契約の
 * 再検査）まで差し替えると、fake で回すテストは fake 自身を検証するだけになり、
 * 実物と共有しているコードが1行も通らない。差し替わるのは「Runtime が何を返したか」
 * であって「それをどう扱うか」ではない。
 */
export type RuntimeTransport = (
  invocation: RuntimeInvocation,
) => Promise<Response>

/** AgentCore Runtime がセッションの振り分けに使うヘッダー。無いと 400 を返す。 */
const SESSION_HEADER = 'X-Amzn-Bedrock-AgentCore-Runtime-Session-Id'

/**
 * `local`: ローカルの `agentcore dev` が立てた Runtime を HTTP で叩く。
 *
 * デプロイ済み Runtime を SigV4 で叩く `deployed` はここに並べる。切り替えは
 * 呼び出し側ではなくこのモジュールの中で行う（BFF の他の部分は宛先を知らない）。
 */
const localTransport: RuntimeTransport = ({
  taskId,
  prompt,
  sessionId,
  input,
}) =>
  fetch(`${RUNTIME_URL}/invocations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      [SESSION_HEADER]: sessionId,
    },
    // 構造化入力は毎回そのまま送り直す。Runtime 側の会話履歴はコールドスタートで
    // 消えるので、2回目以降に省くと表の無いリクエストが届く（ADR-0004）。
    body: JSON.stringify({ taskId, prompt, sessionId, input }),
    signal: AbortSignal.timeout(RUNTIME_TIMEOUT_MS),
  })

/**
 * 設定が指す実装を返す。呼び出しのたびに引く。
 *
 * WHY: モジュールの読み込み時に1度だけ決めると、設定を立てる順序（テストの
 * setup ファイルと import の前後関係）に結果が依存する。返すのは関数への参照
 * だけなので、毎回引いても代償が無い。
 */
export function loadRuntimeTransport(): RuntimeTransport {
  if (resolveRuntimeClientName() === FAKE_RUNTIME_CLIENT_NAME) {
    return fakeRuntimeTransport
  }
  return localTransport
}
