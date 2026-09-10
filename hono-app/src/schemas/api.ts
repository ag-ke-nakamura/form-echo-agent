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
  /**
   * モデルへ実際に渡した system prompt の全文（**実効システムプロンプト**。ADR-0020）。
   *
   * **`playground.free-prompt` のときだけ値が入る。** 職員が書いた文に Runtime が基準
   * 時刻の付記を足していることを隠さないための欄で、渡したものが読めない検証画面は
   * 成立しない。他4タブでは Runtime が載せないので `undefined` のまま。
   *
   * この欄は複製せず Hono RPC で `nextjs-app` へ型が届く（ADR-0015）。
   */
  systemPrompt?: string
}

/** Guardrail のチェック種別（#43）。 */
export const guardrailCheckTypeSchema = z.enum([
  'promptAttack',
  'sensitiveInformation',
  'contentFilter',
])

export type GuardrailCheckType = z.infer<typeof guardrailCheckTypeSchema>

/**
 * ブロックの findings（ADR-0021）。**`playground.free-prompt` の応答にだけ載る。**
 *
 * 職員のこの画面での仕事はプロンプトを直すことなので、種別だけの二値では直した
 * 効果を測れない。他4タブでは ADR-0009 の固定文言だけが返る。**載せるかどうかを
 * 決めるのは Runtime で、BFF は通すだけ** — 判断を2箇所に置くと、片方だけが
 * 他4タブへ広がったときに気付けない。
 */
export const guardrailReportSchema = z.object({
  /** 入力側でブロックされたのか出力側でブロックされたのか。 */
  direction: z.enum(['INPUT', 'OUTPUT']),
  findings: z.array(
    z.object({
      checkType: guardrailCheckTypeSchema,
      /**
       * 反応したカテゴリまたは PII 型と、そのスコア（`JAILBREAK(1)` /
       * `my_number(regex)`）。`contentFilter` と `promptAttack` は `severityScore`、
       * `sensitiveInformation` は `confidenceScore`。
       */
      detail: z.string(),
      /** 日本固有 PII の正規表現（`code-regex`）か AWS 側の判定（`strategy`）か。 */
      source: z.enum(['code-regex', 'strategy']),
    }),
  ),
})

export type GuardrailReport = z.infer<typeof guardrailReportSchema>

export interface AiErrorResponse {
  error: {
    code: AiErrorCode
    message: string
    /**
     * `GUARDRAIL_BLOCKED` かつ `playground.free-prompt` のときだけ（ADR-0021）。
     * **`message` は他4タブと同じ固定文言のまま。**
     *
     * この欄も複製せず Hono RPC で `nextjs-app` へ型が届く（ADR-0015）。
     */
    guardrail?: GuardrailReport
  }
}
