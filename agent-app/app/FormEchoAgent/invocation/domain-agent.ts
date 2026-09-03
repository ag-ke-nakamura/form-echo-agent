import { Agent } from '@strands-agents/sdk';
import { type Domain, domainOf, type TaskId } from '../contracts/index.js';
import { loadModel } from '../model/load.js';
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
    // 基準時刻を貼り直す。system prompt は Agent の生成時に固定されるので、
    // 追加の指示を1時間後に送ると「今から3時間後」が初回の時刻から数えられる。
    // 会話履歴は messages 側に残るため、ここを差し替えても続きとして通る。
    existing.systemPrompt = buildSystemPrompt(taskId);
    return existing;
  }
  if (agentCache.size >= AGENT_CACHE_LIMIT) {
    const oldest = agentCache.keys().next().value;
    if (oldest !== undefined) agentCache.delete(oldest);
  }
  const agent = new Agent({
    name: DOMAIN_AGENT_NAMES[domainOf(taskId)],
    // 空配列でも省略せずに書く。「まだ足していない」のか「足さないと決めた」のかを
    // 区別するため。会議ロジは Websearch を持たない（F-22）— 候補日程の生成は
    // 入力文と基準日だけで閉じており、裏を取る対象が無い。交通ICだけは第3段で
    // Websearch（AgentCore Gateway）が入るので、そのときドメインごとの表になる。
    tools: [],
    model: loadModel(),
    systemPrompt: buildSystemPrompt(taskId),
  });
  agentCache.set(key, agent);
  return agent;
}
