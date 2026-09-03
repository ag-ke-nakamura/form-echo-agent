import { Agent, type ToolList } from '@strands-agents/sdk';
import { type Domain, domainOf, type TaskId } from '../contracts/index.js';
import { loadModel } from '../model/load.js';
import { buildSystemPrompt } from './system-prompt.js';

interface DomainAgentSpec {
  /** ログと Observability に出る表示名。 */
  name: string;
  /**
   * このドメインエージェントに渡すツール。
   *
   * WHY: 空配列でも省略せず明示する。「まだ足していない」のか「足さないと決めた」
   * のかを区別するため。会議ロジは Websearch を持たない（F-22）— 候補日程の生成は
   * 入力文と基準日だけで閉じており、裏を取る対象が無い。交通ICは第3段で
   * Websearch（AgentCore Gateway）がここに入る。
   */
  tools: ToolList;
}

/**
 * ドメインエージェントの定義。taskId のドメイン部から引く。
 *
 * 2ドメインなので素の表で足り、Strands の Graph / Swarm / agent-as-tool は
 * 使わない。ドメイン間で協調させる必要が出た時点で見直す。
 */
const DOMAIN_AGENTS: Record<Domain, DomainAgentSpec> = {
  'ic-card': { name: '交通ICドメインエージェント', tools: [] },
  meeting: { name: '会議ロジドメインエージェント', tools: [] },
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
 * taskId までをキーに含めるのは、明示モードでは system prompt が taskId ごとに
 * 変わり、Agent の生成時に固定されるため。同じセッションでタブを切り替えても
 * 前のタブの Skill が混ざらない。
 */
const agentCache = new Map<string, Agent>();

export function getOrCreateDomainAgent(
  sessionId: string,
  taskId: TaskId,
): Agent {
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
  const spec = DOMAIN_AGENTS[domainOf(taskId)];
  const agent = new Agent({
    name: spec.name,
    tools: spec.tools,
    model: loadModel(),
    systemPrompt: buildSystemPrompt(taskId),
  });
  agentCache.set(key, agent);
  return agent;
}
