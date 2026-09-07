import { z } from 'zod'
import type { AiErrorCode } from './errors.js'

/** 参照ドキュメント 10.1節の入力サニタイズが課す上限。 */
export const MAX_PROMPT_LENGTH = 10_000

/**
 * 複数回やり取り時のセッション識別子。BFF が発行した UUID だけを受け付ける。
 *
 * WHY: この値はそのまま AgentCore のセッション ID になり、Runtime 側で
 * どの会話履歴に載るかを決める。任意の文字列を通すと (1) 他人のセッションを
 * 指定して履歴を読み書きできてしまう（認証は未実装なので防げるのはここだけ）
 * (2) デプロイ済み Runtime の `InvokeAgentRuntime` が要求する33文字以上を
 * 満たさず、利用者には INTERNAL_ERROR としか見えない失敗になる。
 */
export const sessionIdSchema = z.uuid()

export const usageSchema = z.object({
  inputTokens: z.number(),
  outputTokens: z.number(),
  totalTokens: z.number(),
})

export type Usage = z.infer<typeof usageSchema>

/**
 * Web 検索の Search Result 1件の出典（#46）。
 *
 * **AWS の Web Search Tool の「許容される利用方法」が表示を義務づけている。**
 * 出典（`title`）とリンク（`url`）の両方を、職員に見せる出力に添える。
 * **本文（`text`）は載せない。** 表示の義務が掛かっているのは出典とリンクであって
 * 本文ではなく、載せると応答が1件あたり数千字ぶん太る。
 */
export const webSearchCitationSchema = z.object({
  /** 出典（ページのタイトル）。Search Result が持たなければ URL で代える。 */
  title: z.string(),
  url: z.url(),
  /** 公開日。Search Result が持つときだけ。 */
  publishedDate: z.string().optional(),
})

export type WebSearchCitation = z.infer<typeof webSearchCitationSchema>

export interface AiTaskSuccessResponse<TResult = unknown> {
  sessionId: string
  result: TResult
  usage: Usage
  /**
   * この応答を作るのに Runtime が実際に取得した Search Result の出典（#46）。
   *
   * **AI の出力（`result.sources`）とは別物で、こちらが表示の正典になる。**
   * Web 検索を使わなかった応答では空配列。持たないドメイン（会議ロジ）でも空配列。
   */
  citations: WebSearchCitation[]
}

export interface AiErrorResponse {
  error: {
    code: AiErrorCode
    message: string
  }
}
