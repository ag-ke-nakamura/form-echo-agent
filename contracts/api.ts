import { z } from 'zod';
import type { AiErrorCode } from './errors.js';
import { ALLOWED_TASK_IDS } from './task-ids.js';
import { checkTaskInput } from './task-input.js';

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

export const aiTaskRequestSchema = z
  .object({
    taskId: z.enum(ALLOWED_TASK_IDS),
    /**
     * 職員が書いた自然文。**必須かどうかは taskId ごとに違う**（ADR-0004）。
     * 推薦系は参加可否表だけで成立するため、省略できる。
     */
    prompt: z.string().min(1).max(MAX_PROMPT_LENGTH).nullish(),
    /** 初回は null または省略。 */
    sessionId: sessionIdSchema.nullish(),
    /**
     * 構造化入力。形は taskId ごとに `INPUT_SCHEMAS` が決めるので、ここでは
     * `unknown` で受けて下の `superRefine` が taskId を見てから検査する。
     *
     * WHY: taskId で discriminated union にすると既存3タスクのリクエスト型まで
     * 書き換わる（ADR-0004 が却下した案）。3者が同一に見ているのは**表**であって
     * 個々のスキーマではない、という `OUTPUT_SCHEMAS` と同じ形をここでも採る。
     */
    input: z.unknown().optional(),
  })
  .superRefine((request, ctx) => {
    // 判断は契約の表に置き、ここは失敗を zod の issue に翻訳するだけにする。
    const checked = checkTaskInput(request.taskId, request);
    if (checked.ok) return;

    switch (checked.problem.kind) {
      case 'PROMPT_REQUIRED':
        ctx.addIssue({
          code: 'custom',
          path: ['prompt'],
          message: `${request.taskId} は自然文の指示が必要です。`,
        });
        return;
      case 'INPUT_NOT_ACCEPTED':
        ctx.addIssue({
          code: 'custom',
          path: ['input'],
          message: `${request.taskId} は構造化入力を受け付けません。`,
        });
        return;
      case 'INPUT_INVALID':
        for (const issue of checked.problem.issues) {
          ctx.addIssue({ ...issue, path: ['input', ...issue.path] });
        }
        return;
    }
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
