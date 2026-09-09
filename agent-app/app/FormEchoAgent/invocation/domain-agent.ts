import { Agent } from '@strands-agents/sdk';
import { type Domain, domainOf, type TaskId } from '../contracts/index.js';
import { loadModel } from '../model/load.js';
import { loadDomainTools } from '../tools/load.js';
import { buildSystemPrompt } from './system-prompt.js';

/**
 * ドメインエージェントの名前。taskId のドメイン部から引く。
 *
 * 2ドメインなので素の表で足り、Strands の Graph / Swarm / agent-as-tool は
 * 使わない。ドメイン間で協調させる必要が出た時点で見直す。
 */
const DOMAIN_AGENT_NAMES: Record<Domain, string> = {
  'ic-card': '交通ICドメインエージェント',
  meeting: '会議ロジドメインエージェント',
  // 業務のドメインではなく、プロンプトの効きを測る道具（`CONTEXT.md`「検証ドメイン」）。
  playground: '検証ドメインエージェント',
};

const AGENT_CACHE_LIMIT = 128;

/**
 * セッションごとに Agent を1つ再利用し、会話履歴をセッション内に閉じる
 * （ベストエフォート。コールドスタートで消える）。Map は挿入順を保つので、
 * そのまま 128 セッションを上限とする LRU にもなる — 多数のセッションを捌く
 * ローカルのプロセスが履歴を混ぜたり無制限に太ったりしない。AgentCore Runtime
 * では microVM 1つが1セッションを持つので、実際の要素は1つになる。
 * 永続的な履歴が要るなら memory を付ける。
 *
 * taskId までをキーに含めるのは、system prompt が taskId ごとに変わり、Agent の
 * 生成時に固定されるため。同じセッションでタブを切り替えても前のタブの Skill が
 * 混ざらない。
 */
const agentCache = new Map<string, Agent>();

/**
 * `input` を受け取るのは、`playground.free-prompt` の system prompt が職員の持ち込んだ
 * 文だからである（ADR-0020）。他4タスクでは使われない。
 *
 * **組み立てた system prompt を Agent と一緒に返す。** `agent.systemPrompt` を後から
 * 読み直す形にはしない — あれはキャッシュヒットのたびに上書きされる可変の欄なので、
 * 読む時点によっては別のリクエストが貼った文が返る。実効システムプロンプトとして
 * 職員へ返すのは**この呼び出しが渡したもの**でなければならない（ADR-0020）。
 */
export function getOrCreateDomainAgent(
  sessionId: string,
  taskId: TaskId,
  input: unknown,
): { agent: Agent; systemPrompt: string } {
  const systemPrompt = buildSystemPrompt(taskId, input);
  const key = `${sessionId}::${taskId}`;
  const existing = agentCache.get(key);
  if (existing) {
    agentCache.delete(key);
    agentCache.set(key, existing);
    // 基準時刻を貼り直す。system prompt は Agent の生成時に固定されるので、
    // 追加の指示を1時間後に送ると「今から3時間後」が初回の時刻から数えられる。
    // 会話履歴は messages 側に残るため、ここを差し替えても続きとして通る。
    existing.systemPrompt = systemPrompt;
    return { agent: existing, systemPrompt };
  }
  if (agentCache.size >= AGENT_CACHE_LIMIT) {
    const oldest = agentCache.keys().next().value;
    if (oldest !== undefined) agentCache.delete(oldest);
  }
  const domain = domainOf(taskId);
  const agent = new Agent({
    name: DOMAIN_AGENT_NAMES[domain],
    // ドメインごとの表から引く（#46）。交通ICだけが Web 検索を持ち、会議ロジは
    // 空のままである — 渡す・渡さないの判断は `tools/load.ts` に置く。
    tools: loadDomainTools(domain),
    model: loadModel(),
    systemPrompt,
    // 既定の printer を切る。モデルのテキストとツールの印を素の stdout へ書くが、
    // Structured Output を一括で受け取る（`stream: false`）この Runtime では逐次
    // テキストが存在せず、残るのはツール名の1行だけ。それが fastify の pino が
    // 出す JSON のログと交ざり、行単位で読めなくなる。
    printer: false,
  });
  agentCache.set(key, agent);
  return { agent, systemPrompt };
}

/**
 * このセッションの Agent をすべて破棄する（#43）。
 *
 * Guardrail がブロックした対象のテキストが会話履歴に残ったまま次のメッセージを
 * 送ると、以降の正常なメッセージまで連鎖的にブロックし続ける（F-14）。
 * `sessionId::taskId` がキーなので、同じセッションの全タブ分をまとめて消す —
 * taskId ごとに残すと、ブロックされた入力を送ったタブ以外の会話が汚染されない
 * 代わりに、同じタブへ戻ったときだけ連鎖が再現する状態になる。
 */
export function discardSession(sessionId: string): void {
  const prefix = `${sessionId}::`;
  for (const key of agentCache.keys()) {
    if (key.startsWith(prefix)) agentCache.delete(key);
  }
}
