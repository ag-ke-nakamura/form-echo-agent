import { z } from 'zod';
import type { AiErrorCode } from './errors.js';
import { ALLOWED_TASK_IDS } from './task-ids.js';

/** 参照ドキュメント 10.1節の入力サニタイズが課す上限。 */
export const MAX_PROMPT_LENGTH = 10_000;

/**
 * `POST /api/ai/tasks` のリクエスト（参照ドキュメント 1.3節）。
 * BFF と Runtime が同じスキーマで検証する。
 */
/**
 * 複数回やり取り時のセッション識別子。BFF が発行した UUID だけを受け付ける。
 *
 * WHY: この値はそのまま AgentCore のセッション ID になり、Runtime 側で
 * どの会話履歴に載るかを決める。任意の文字列を通すと (1) 他人のセッションを
 * 指定して履歴を読み書きできてしまう（認証は未実装なので防げるのはここだけ）
 * (2) デプロイ済み Runtime の `InvokeAgentRuntime` が要求する33文字以上を
 * 満たさず、利用者には INTERNAL_ERROR としか見えない失敗になる。
 */
export const sessionIdSchema = z.uuid();

export const aiTaskRequestSchema = z.object({
  taskId: z.enum(ALLOWED_TASK_IDS),
  prompt: z.string().min(1).max(MAX_PROMPT_LENGTH),
  /** 初回は null または省略。 */
  sessionId: sessionIdSchema.nullish(),
});

export type AiTaskRequest = z.infer<typeof aiTaskRequestSchema>;

export const usageSchema = z.object({
  inputTokens: z.number(),
  outputTokens: z.number(),
  totalTokens: z.number(),
});

export type Usage = z.infer<typeof usageSchema>;

export interface AiTaskSuccessResponse<TResult = unknown> {
  sessionId: string;
  result: TResult;
  usage: Usage;
}

export interface AiErrorResponse {
  error: {
    code: AiErrorCode;
    message: string;
  };
}
