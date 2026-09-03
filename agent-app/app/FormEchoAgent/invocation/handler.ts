import {
  type AiErrorResponse,
  type AiTaskSuccessResponse,
  aiTaskRequestSchema,
} from '../contracts/index.js';
import { invokeTask, StructuredOutputError } from './invoke-task.js';
import type { InvocationLogger } from './logger.js';

/**
 * ハンドラが `RequestContext` から実際に使うものだけ。
 *
 * WHY: `logger.ts` と同じ理由で最小の形に留める。fastify の `RequestContext` は
 * これを構造的に満たすので `main.ts` の配線はそのまま通り、テストと実測は
 * HTTP リクエストも pino も組み立てずにこの境界を呼べる。
 */
export interface InvocationContext {
  /** AgentCore が確定させたセッション ID。会話履歴の帰属先になる。 */
  sessionId: string;
  log: InvocationLogger;
}

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
  context: InvocationContext,
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
          'リクエストが契約に適合しません。taskId ごとに自然文と構造化入力のどちらが必要かは contracts の aiTaskRequestSchema を参照してください。',
      },
    };
  }

  const { taskId, prompt, input } = parsedRequest.data;

  try {
    const { result, usage } = await invokeTask(
      { taskId, prompt, input, sessionId: context.sessionId },
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
