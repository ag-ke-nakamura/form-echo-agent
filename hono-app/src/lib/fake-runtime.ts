import type { Usage } from '@contracts/index.js'
import type {
  RuntimeInvocation,
  RuntimeTransport,
} from './runtime-transport.js'

/**
 * Runtime に接続しないクライアント。`FORMECHO_RUNTIME_CLIENT=fake` で選ばれる
 * （#23 の決定性の確保、#41）。
 *
 * 返す内容は台本（`fakeRuntimeScript`）が持ち、この層は判断を持たない。差し替えるのは
 * **Runtime が何を返したか**だけで、それをどう扱うか（エラーコードへの写像と出力契約の
 * 再検査）は実物と同じ `runtime-client.ts` が決める。
 */

/** 台本が `usage` を指定しなかったときの値。Runtime が返した値を通すだけの欄。 */
export const NO_USAGE: Usage = {
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
}

/** 台本の1手。Runtime が1回呼ばれるたびに先頭から1つ消費される。 */
export type FakeRuntimeTurn =
  /**
   * 成功応答を返す。**受け取った `sessionId` をそのまま返す** — 実物の Runtime は
   * ヘッダーで渡された値を応答に載せるので、fake もそこを真似る必要がある
   * （BFF が発行した ID が呼び出し側へ返るかは、これが無いと言えない）。
   */
  | { kind: 'succeed'; result: unknown; usage?: Usage }
  /** 本文と状態コードを直に指定する。成功の形をしていない応答はこちらで書く。 */
  | { kind: 'respond'; status?: number; body: unknown }
  /** 時間内に応答しない（Runtime は生きているが遅い）。 */
  | { kind: 'timeout' }
  /** 接続そのものが張れない（Runtime が居ない）。 */
  | { kind: 'unreachable' }

/** 台本が尽きたのに Runtime が呼ばれた。 */
class FakeRuntimeScriptExhaustedError extends Error {
  constructor(callCount: number) {
    super(
      `fake の Runtime クライアントの台本が尽きました（${callCount} 回目の呼び出し）。想定より多く呼ばれているか、台本が足りません。`,
    )
  }
}

/**
 * fake が返すものと、受け取ったものの記録。
 *
 * WHY: モジュール変数として1つ持つ。差し替えは設定で行うと決めた以上、Hono の
 * ハンドラから台本を渡す経路は無い（`app.request()` に渡せるのは HTTP の中身だけ）。
 * 台本の受け渡しも設定と同じくアプリケーションの外側に置くことになる。
 */
class FakeRuntimeScript {
  #turns: FakeRuntimeTurn[] = []
  #calls: RuntimeInvocation[] = []

  /** Runtime が返すものを順に積む。 */
  write(...turns: FakeRuntimeTurn[]): void {
    this.#turns.push(...turns)
  }

  /** 台本と記録を空に戻す。テストごとに呼ぶ。 */
  reset(): void {
    this.#turns = []
    this.#calls = []
  }

  /** Runtime が受け取った呼び出しの記録。古いものから並ぶ。 */
  get calls(): readonly RuntimeInvocation[] {
    return this.#calls
  }

  /**
   * 次の1手を取り出し、呼び出しを記録する。`fakeRuntimeTransport` だけが呼ぶ。
   *
   * 尽きたら例外にする。同じ手を返し続けると、想定より多い呼び出しが表に出ない。
   */
  take(invocation: RuntimeInvocation): FakeRuntimeTurn {
    this.#calls.push(invocation)
    const turn = this.#turns.shift()
    if (turn === undefined) {
      throw new FakeRuntimeScriptExhaustedError(this.#calls.length)
    }
    return turn
  }
}

export const fakeRuntimeScript = new FakeRuntimeScript()

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export const fakeRuntimeTransport: RuntimeTransport = async (invocation) => {
  const turn = fakeRuntimeScript.take(invocation)

  switch (turn.kind) {
    case 'succeed':
      return jsonResponse(200, {
        sessionId: invocation.sessionId,
        result: turn.result,
        usage: turn.usage ?? NO_USAGE,
      })
    case 'respond':
      return jsonResponse(turn.status ?? 200, turn.body)
    case 'timeout':
      // `AbortSignal.timeout` が投げるものと同じ形にする。タイムアウトと接続失敗を
      // 見分ける判断は呼び出し側にあり、fake はどちらが起きたかだけを決める。
      throw new DOMException(
        'The operation was aborted due to timeout',
        'TimeoutError',
      )
    case 'unreachable':
      throw new TypeError('fetch failed')
  }
}
