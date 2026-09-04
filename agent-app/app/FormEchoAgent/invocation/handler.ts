import {
  type AiErrorResponse,
  type AiTaskSuccessResponse,
  aiTaskRequestSchema,
  type WebSearchCitation,
} from '../contracts/index.js';
import type { WebSearchHit } from '../tools/web-search.js';
import { invokeTask, StructuredOutputError } from './invoke-task.js';
import type { InvocationLogger } from './logger.js';

/**
 * 取得した Search Result を、職員に見せる出典に落とす（#46）。
 *
 * **本文は落とし、出典（`title`）とリンク（`url`）だけを残す。** AWS の Web Search
 * Tool の「許容される利用方法」が表示を義務づけているのは出典とリンクであって、
 * 本文ではない。載せると応答が1件あたり数千字ぶん太るだけになる。
 *
 * 「一括での抽出・保存・再現の禁止」は**ここでは理由にならない。** 本文はモデルへ
 * 渡しており（渡さなければ裏取りが成立しない）、応答に載せないことをあの条項で
 * 説明すると自分たちの実装と食い違う。
 *
 * URL で重複を落とす。1リクエストで最大3回検索するので、同じページが複数回返る。
 * タイトルが空の結果は URL で代える — 出典の欄が空のリンクは、職員には
 * どこの情報か分からない。
 */
function toCitations(hits: readonly WebSearchHit[]): WebSearchCitation[] {
  const byUrl = new Map<string, WebSearchCitation>();
  for (const hit of hits) {
    if (byUrl.has(hit.url)) continue;
    byUrl.set(hit.url, {
      title: hit.title.trim() === '' ? hit.url : hit.title,
      url: hit.url,
      ...(hit.publishedDate === undefined
        ? {}
        : { publishedDate: hit.publishedDate }),
    });
  }
  return [...byUrl.values()];
}

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
    const { result, usage, webSearchHits } = await invokeTask(
      { taskId, prompt, input, sessionId: context.sessionId },
      context.log,
    );
    return {
      sessionId: context.sessionId,
      result,
      usage,
      citations: toCitations(webSearchHits),
    };
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
