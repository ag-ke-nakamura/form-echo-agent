import {
  type AiErrorResponse,
  type AiTaskSuccessResponse,
  aiTaskRequestSchema,
  FREE_PROMPT_TASK_ID,
} from '../contracts/index.js';
/*
  出典への落とし込みはツール側に置く（#174）。**出典番号の並びを決めるのが
  `toCitations` なので、モデルへ番号を渡す側と応答に載せる側が同じ関数を引く必要が
  ある** — 2箇所で並べると、モデルが指した番号と職員が見る一覧の番号が食い違う。
*/
import { toCitations } from '../tools/web-search.js';
import {
  GuardrailBlockedError,
  invokeTask,
  StructuredOutputError,
} from './invoke-task.js';
import type { InvocationLogger } from './logger.js';

/**
 * 画面へ出す文言（参照ドキュメント 9.3節）。どのチェックが反応したかは出さない
 * （10.4節、`docs/adr/0009-guardrail-block-message-wording.md`）。
 */
const GUARDRAIL_BLOCKED_MESSAGE =
  '入力内容に問題があります。個人情報（マイナンバー等）が含まれていないか確認してください。';

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
    const { result, usage, webSearchHits, systemPrompt } = await invokeTask(
      { taskId, prompt, input, sessionId: context.sessionId },
      context.log,
    );
    return {
      sessionId: context.sessionId,
      result,
      usage,
      citations: toCitations(webSearchHits),
      // 他4タブでは undefined。JSON 化の時点で欄ごと消える（ADR-0020）。
      systemPrompt,
    };
  } catch (error) {
    context.log.error({ err: error }, 'invocation に失敗しました');
    if (error instanceof GuardrailBlockedError) {
      return {
        error: {
          code: 'GUARDRAIL_BLOCKED',
          message: GUARDRAIL_BLOCKED_MESSAGE,
          /*
            **他4タブに対してだけ `verdict` を握り潰す**（ADR-0021 が ADR-0009 を
            この1点で改訂した）。プロンプト検証タブの職員の仕事はプロンプトを直す
            ことなので、種別だけの二値では直した効果を測れない。他4タブでは職員の
            取る行動が変わらないので、回避のオラクルになる情報を渡す理由が無い。

            出力側でブロックされても回答本文は載らない — この経路には `result` が
            そもそも無い（例外が返り値を追い越している）。
          */
          guardrail:
            taskId === FREE_PROMPT_TASK_ID
              ? { direction: error.direction, findings: error.verdict.findings }
              : undefined,
        },
      };
    }
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
