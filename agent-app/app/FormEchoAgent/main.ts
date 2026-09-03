import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Agent } from '@strands-agents/sdk';
import {
  BedrockAgentCoreApp,
  type RequestContext,
} from 'bedrock-agentcore/runtime';
import type { z } from 'zod';
import {
  type AiErrorResponse,
  type AiTaskSuccessResponse,
  aiTaskRequestSchema,
  type Domain,
  domainOf,
  OUTPUT_SCHEMAS,
  type TaskId,
  type Usage,
} from './contracts/index.js';
import { loadModel } from './model/load.js';

/**
 * ドメインエージェントの名前。taskId のドメイン部から引く。
 *
 * 2ドメイン以下なので素の表で足り、Strands の Graph / Swarm / agent-as-tool は
 * 使わない。ドメイン間で協調させる必要が出た時点で見直す。
 */
const DOMAIN_AGENT_NAMES: Record<Domain, string> = {
  'ic-card': '交通ICドメインエージェント',
};

/**
 * Structured Output が出力契約に適合しなかったときの試行回数の上限。
 * 参照ドキュメント 6.3節の「1回目失敗 → 再試行、2回目失敗 → エラー」に対応する。
 */
const MAX_STRUCTURED_OUTPUT_ATTEMPTS = 2;

const AGENT_CACHE_LIMIT = 128;

/**
 * skills/ を指す基準になるパッケージルート。
 *
 * WHY: このモジュールは `main.ts`（tsx 実行）としても `dist/main.js` としても動く。
 * import.meta.url からの相対位置が両者で1階層ずれるので、package.json のある
 * ところまで遡ってパッケージルートを決める。
 */
function findPackageRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  while (!existsSync(join(dir, 'package.json'))) {
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(
        'package.json が見つからず skills/ の位置を決められません',
      );
    }
    dir = parent;
  }
  return dir;
}

const PACKAGE_ROOT = findPackageRoot();

/**
 * 明示モードの Skill 読み込み。taskId が Skill を一意に決め、`SKILL.md` の本文を
 * そのまま system prompt に注入する。ドメインエージェントに選ばせる自動モードは
 * `AgentSkills` プラグインを入れるチケットで足す。
 */
function loadSkill(taskId: TaskId): string {
  const [domain, task] = taskId.split('.');
  return readFileSync(
    join(PACKAGE_ROOT, 'skills', domain, task, 'SKILL.md'),
    'utf8',
  );
}

/**
 * 相対的な日付表現（「来月15日」「3泊4日」）を解決する基準日。
 *
 * WHY: モデルは現在時刻を持たないので、与えなければ学習データ由来の日付を
 * 使ってしまう。JST 固定なのは、利用者が国内で働く職員だから。
 * `sv-SE` ロケールは YYYY-MM-DD を返す。
 */
function todayInJst(): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(
    new Date(),
  );
}

function buildSystemPrompt(taskId: TaskId): string {
  return `${loadSkill(taskId)}\n\n## 基準日\n\n今日は ${todayInJst()}（JST）です。相対的な日付表現はこの日を基準に解決してください。`;
}

/**
 * セッションごとに Agent を1つ再利用し、会話履歴をセッション内に閉じる
 * （ベストエフォート。コールドスタートで消える）。Map は挿入順を保つので、
 * そのまま 128 セッションを上限とする LRU にもなる — 多数のセッションを捌く
 * ローカルのプロセスが履歴を混ぜたり無制限に太ったりしない。AgentCore Runtime
 * では microVM 1つが1セッションを持つので、実際の要素は1つになる。
 * 永続的な履歴が要るなら memory を付ける。
 *
 * taskId までをキーに含めるのは、明示モードでは system prompt が taskId ごとに
 * 変わり、Agent の生成時に固定されるため。
 */
const agentCache = new Map<string, Agent>();

async function getOrCreateAgent(
  sessionId: string,
  taskId: TaskId,
): Promise<Agent> {
  const key = `${sessionId}::${taskId}`;
  const existing = agentCache.get(key);
  if (existing) {
    agentCache.delete(key);
    agentCache.set(key, existing);
    return existing;
  }
  if (agentCache.size >= AGENT_CACHE_LIMIT) {
    const oldest = agentCache.keys().next().value;
    if (oldest !== undefined) agentCache.delete(oldest);
  }
  const agent = new Agent({
    name: DOMAIN_AGENT_NAMES[domainOf(taskId)],
    model: loadModel(),
    systemPrompt: buildSystemPrompt(taskId),
  });
  agentCache.set(key, agent);
  return agent;
}

/** 出力契約に適合した結果が得られなかったことを表す。BFF へ PARSE_FAILED を返す。 */
class StructuredOutputError extends Error {}

async function invokeWithSchemaRetry(
  agent: Agent,
  prompt: string,
  schema: z.ZodType,
  log: RequestContext['log'],
): Promise<{ result: unknown; usage: Usage }> {
  let lastFailure: unknown;
  for (let attempt = 1; attempt <= MAX_STRUCTURED_OUTPUT_ATTEMPTS; attempt++) {
    // 試行のたびに履歴のスナップショットを取り、失敗したら戻す。
    //
    // WHY: Agent はモデルを呼ぶ前にユーザーメッセージを履歴へ足すが、途中で
    // 失敗しても Strands は履歴を巻き戻さずに例外を投げ直す。戻さずに再試行すると
    // user メッセージが連続し、role の厳密な交替を要求するプロバイダ
    // （Anthropic など）に拒否されて、再試行が必ず失敗する。最後の試行で戻すのは、
    // 失敗したターンをキャッシュされた Agent に残さず、このセッションを次の
    // リクエストでも使えるようにするため。
    const snapshot = agent.takeSnapshot({ include: ['messages'] });
    try {
      const invocation = await agent.invoke(prompt, {
        structuredOutputSchema: schema,
      });
      const parsed = schema.safeParse(invocation.structuredOutput);
      if (parsed.success) {
        // この1回の呼び出し分だけを返す。accumulatedUsage は Agent の生涯合計で、
        // セッションを跨いで再利用されると2ターン目以降が積み上がった値になる。
        const usage = invocation.metrics?.latestAgentInvocation?.usage;
        return {
          result: parsed.data,
          usage: {
            inputTokens: usage?.inputTokens ?? 0,
            outputTokens: usage?.outputTokens ?? 0,
            totalTokens: usage?.totalTokens ?? 0,
          },
        };
      }
      lastFailure = parsed.error;
    } catch (error) {
      lastFailure = error;
    }
    agent.loadSnapshot(snapshot);
    // 再試行して成功した場合、失敗した1回目は呼び出し側から見えなくなる。
    // プロンプトの効きを追うには何が起きたかが要るので、試行ごとに残す。
    log.warn(
      { err: lastFailure, attempt },
      'Structured Output の取得に失敗しました',
    );
  }
  throw new StructuredOutputError(
    'Structured Output が出力契約に適合しませんでした',
    { cause: lastFailure },
  );
}

const app = new BedrockAgentCoreApp({
  invocationHandler: {
    // リクエストの検査を `requestSchema` に任せず自前で行う。
    //
    // WHY: bedrock-agentcore 0.3.0 の `requestSchema` は検査に落ちたとき
    // `reply.status(400).send(object)` を Content-Type を指定せずに呼ぶ。
    // 呼び出し側が `Accept: text/event-stream` を送っていると @fastify/sse が
    // 応答を握っており、fastify は object を拒否する
    // （FST_ERR_REP_INVALID_PAYLOAD_TYPE）。結果、本来 400 で返るはずのものが
    // 本文の無い 500 になり、何が悪いのか呼び出し側に伝わらない。
    // ここで検査すれば、成功時と同じ経路で出力契約のエラーコードを返せる。
    async process(
      payload: unknown,
      context,
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
      const agent = await getOrCreateAgent(context.sessionId, taskId);

      // 履歴の巻き戻しは invokeWithSchemaRetry が試行ごとに行うので、ここでは持たない。
      try {
        const { result, usage } = await invokeWithSchemaRetry(
          agent,
          prompt,
          OUTPUT_SCHEMAS[taskId],
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
    },
  },
});

app.run({ port: Number.parseInt(process.env.PORT ?? '8080', 10) });
