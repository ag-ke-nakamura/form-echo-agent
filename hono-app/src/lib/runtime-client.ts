import { z } from 'zod'
import type {
  AiErrorCode,
  AiTaskSuccessResponse,
  GuardrailReport,
} from '../schemas/index.js'
import {
  guardrailReportSchema,
  isAiErrorCode,
  outputSchemaFor,
  usageSchema,
  webSearchCitationSchema,
} from '../schemas/index.js'
import type { RuntimeInvocation } from './runtime-transport.js'
import { loadRuntimeTransport } from './runtime-transport.js'

export type RuntimeOutcome =
  | { ok: true; response: AiTaskSuccessResponse }
  | {
      ok: false
      code: AiErrorCode
      message: string
      /**
       * ブロックの findings（ADR-0021）。**Runtime が載せたときだけ通す。**
       *
       * 載せるかどうかを決めるのは Runtime（`playground.free-prompt` のときだけ）で、
       * BFF はここで taskId を見ない。**同じ判断を2箇所に置くと、片方だけが他4タブへ
       * 広がったときに気付けない。**
       */
      guardrail?: GuardrailReport
    }

/**
 * Runtime を呼び、返ってきたものを出力契約のエラーコードか成功応答に写す。
 *
 * 宛先と通信のしかたは `runtime-transport.ts` が設定から決める（ローカル /
 * デプロイ済み / fake）。**この関数はどれが選ばれたかを知らない** — 通信が
 * 差し替わっても、応答の解釈はここ1箇所を通る。
 */
export async function invokeRuntime(
  invocation: RuntimeInvocation,
): Promise<RuntimeOutcome> {
  // 設定の解決を try の外に置く。中に入れると、綴りを間違えた
  // `FORMECHO_RUNTIME_CLIENT` が下の catch に飲まれて RUNTIME_UNAVAILABLE になり、
  // 「設定が間違っている」が「Runtime が落ちている」に化ける。
  const transport = loadRuntimeTransport()

  let response: Response
  try {
    response = await transport(invocation)
  } catch (error) {
    // TimeoutError と、接続そのものが張れない場合（Runtime が落ちている）を分ける。
    // 画面の案内が「もう一度お試しください」と「手動で入力してください」で違うため。
    //
    // TimeoutError 以外を型で絞らない。undici は接続失敗を `TypeError: fetch failed`
    // で投げるが Bun は別の形で投げるので、型で分岐すると `dev`（Bun）でだけ
    // 判定が変わる。この try に残るのは通信だけなので、既定を寄せて構わない。
    //
    // `.name` だけで見る（`instanceof DOMException` に絞らない）。ローカル経路は
    // `AbortSignal.timeout` の DOMException だが、デプロイ済み経路（SigV4）の
    // `@smithy/node-http-handler` は同じ意味のタイムアウトを普通の Error で投げる。
    if (isTimeoutError(error)) {
      return {
        ok: false,
        code: 'TIMEOUT',
        message: 'Runtime が時間内に応答しませんでした。',
      }
    }
    // デプロイ済み経路（SigV4）では AWS SDK の型付き例外（権限不足・リクエスト形式
    // 不正・スロットリング等）もここを通り、すべて RUNTIME_UNAVAILABLE に潰れる。
    // 記録しないと、設定ミスと実際の障害の区別が運用時に一切付かなくなる。
    console.error('Runtime の呼び出しに失敗しました。', error)
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
    // 4xx は Runtime がこの BFF の投げ方を拒否したということで、職員ではなく
    // 我々の側の不整合。職員に再入力を促しても直らないので INTERNAL_ERROR にする。
    return {
      ok: false,
      code: 'INTERNAL_ERROR',
      message: `Runtime がリクエストを受け付けませんでした（${response.status}）。`,
    }
  }

  if (isRuntimeError(body)) {
    return {
      ok: false,
      code: body.error.code,
      message: body.error.message,
      guardrail: guardrailReport(body.error),
    }
  }

  const parsed = runtimeSuccessShape(body)
  if (!parsed) {
    return {
      ok: false,
      code: 'PARSE_FAILED',
      message: 'Runtime のレスポンスが想定の形ではありませんでした。',
    }
  }

  // 出力契約は Runtime 側でも検査済みだが、BFF でも自分の複製したスキーマで見る
  // （ADR-0011。Runtime とは独立した実装なので、BFF 単体でも不正な出力を弾ける）。
  //
  // 推薦系では入力も渡す。提案が入力の候補日程と過不足なく対応しているかは
  // 出力契約だけでは言えない（ADR-0004）。Runtime の作り直しを通り抜けたものが、
  // フロントエンドへ出る前にここで最後に落ちる。
  const result = outputSchemaFor(invocation.taskId, invocation.input).safeParse(
    parsed.result,
  )
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
      citations: parsed.citations,
      // プロンプト検証のときだけ載る（ADR-0020）。他4タブでは undefined のまま。
      systemPrompt: parsed.systemPrompt,
    },
  }
}

function isTimeoutError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: unknown }).name === 'TimeoutError'
  )
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

/**
 * ブロックの findings を契約で読む（ADR-0021）。
 *
 * **壊れていたら落とすが、`PARSE_FAILED` にはしない。** 出典（`citations`）や実効
 * システムプロンプトと扱いが逆なのは、こちらが失敗の応答だから — findings を理由に
 * コードを差し替えると、**Guardrail がブロックしたという事実そのものが画面から
 * 消えて**「AI の出力形式が不正です」に化ける。落としても画面は固定文言で正しく
 * ブロックを伝えるので、失うのは findings だけである。黙らせないために記録は残す。
 */
function guardrailReport(error: object): GuardrailReport | undefined {
  if (!('guardrail' in error) || error.guardrail === undefined) return undefined
  const parsed = guardrailReportSchema.safeParse(error.guardrail)
  if (parsed.success) return parsed.data
  console.error(
    'Runtime が返した Guardrail の findings が契約に適合しません。',
    parsed.error.issues,
  )
  return undefined
}

function runtimeSuccessShape(body: unknown): AiTaskSuccessResponse | null {
  if (typeof body !== 'object' || body === null) return null
  const candidate = body as Partial<AiTaskSuccessResponse>
  if (typeof candidate.sessionId !== 'string') return null
  if (candidate.result === undefined) return null
  // usage も契約で見る。`result` を契約で見て usage を見ない非対称に理由がない
  // （欄が欠けた usage は画面のトークン表示をそのまま壊す）。
  const usage = usageSchema.safeParse(candidate.usage)
  if (!usage.success) return null
  /*
    出典も契約で見る（#46）。AWS の Web Search Tool の「許容される利用方法」が
    表示を義務づけているので、**壊れた出典を黙って落とさない** — 落とすと、
    検索結果を使った回答を出典なしで職員に見せることになる。欄ごと無い応答は
    空配列として通す（Web 検索を持たないドメインと、この欄を持たない版の
    Runtime がここに来る）。
  */
  const citations = z
    .array(webSearchCitationSchema)
    .safeParse(candidate.citations ?? [])
  if (!citations.success) return null
  /*
    実効システムプロンプトも見る（#201）。**黙って落とさない** — 落とすと、我々が
    基準時刻を足したことを職員に見せないまま画面が成功として描く（ADR-0020）。
    欄ごと無い応答はそのまま通す（他4タブと、この欄を持たない版の Runtime）。
  */
  if (
    candidate.systemPrompt !== undefined &&
    typeof candidate.systemPrompt !== 'string'
  )
    return null
  return {
    ...candidate,
    usage: usage.data,
    citations: citations.data,
  } as AiTaskSuccessResponse
}
