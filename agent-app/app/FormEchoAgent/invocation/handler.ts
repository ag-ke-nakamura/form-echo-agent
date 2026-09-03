import type { RequestContext } from 'bedrock-agentcore/runtime';
import {
  type AiErrorResponse,
  type AiTaskSuccessResponse,
  aiTaskRequestSchema,
} from '../contracts/index.js';
import { invokeTask, StructuredOutputError } from './invoke-task.js';

/**
 * `BedrockAgentCoreApp` の invocation ハンドラ。リクエストの検査と、
 * invocation 境界が投げた失敗の出力契約のエラーコードへの写像だけを持つ。
 *
 * リクエストの検査を `BedrockAgentCoreApp` の `requestSchema` に任せず自前で行う。
 *
 * WHY: bedrock-agentcore 0.3.0 の `requestSchema` は検査に落ちたとき
 * `reply.status(400).send(object)` を Content-Type を指定せずに呼ぶ。
 * 呼び出し側が `Accept: text/event-stream` を送っていると @fastify/sse が
 * 応答を握っており、fastify は object を拒否する
 * （FST_ERR_REP_INVALID_PAYLOAD_TYPE）。結果、本来 400 で返るはずのものが
 * 本文の無い 500 になり、何が悪いのか呼び出し側に伝わらない。
 * ここで検査すれば、成功時と同じ経路で出力契約のエラーコードを返せる。
 */
export async function handleInvocation(
  payload: unknown,
  context: RequestContext,
): Promise<AiTaskSuccessResponse | AiErrorResponse> {
  const parsedRequest = aiTaskRequestSchema.safeParse(payload);
  if (!parsedRequest.success) {
    context.log.warn(
      { issues: parsedRequest.error.issues },
      'リクエストが出力契約のリクエスト型に適合しません',
    );
    return {
      error: {
        code: 'INVALID_INPUT',
        message:
          'リクエストは taskId と prompt を持つ必要があります（出力契約の aiTaskRequestSchema を参照）。',
      },
    };
  }

  const { taskId, prompt } = parsedRequest.data;

  try {
    const { result, usage } = await invokeTask(
      { taskId, prompt, sessionId: context.sessionId },
      context.log,
    );
    return { sessionId: context.sessionId, result, usage };
  } catch (error) {
    context.log.error({ err: error }, 'invocation に失敗しました');
    if (error instanceof StructuredOutputError) {
      return {
        error: { code: 'PARSE_FAILED', message: error.message },
      };
    }
    // 想定外の失敗は握り潰さず 500 にして、BFF に RUNTIME_UNAVAILABLE を
    // 出させる。ここで既知のコードに丸めると原因が消える。
    throw error;
  }
}
