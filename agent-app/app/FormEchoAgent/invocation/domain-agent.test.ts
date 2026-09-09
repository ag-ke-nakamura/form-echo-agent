import { afterEach, describe, expect, it } from 'vitest';
import { type Domain, domainOf, type TaskId } from '../contracts/index.js';
import {
  clearWebSearchGateway,
  newSessionId,
  useWebSearchGateway,
} from '../tests/harness.js';
import { getOrCreateDomainAgent } from './domain-agent.js';

/**
 * taskId のドメイン部からドメインエージェントを選ぶところ（#40 の「テストするもの」
 * その1）。
 *
 * **invocation 境界の側からは言えないのでここで見る。** ドメインエージェントの違いは
 * `Agent` の名前と（第3段で足す）ツールにしか出ず、モデルへ届く system prompt は
 * タスク部で決まる Skill なので、`handler.test.ts` の検証はドメイン部が壊れても通る。
 *
 * 名前を固定値で書くのは、`domain-agent.ts` の表と突き合わせるため。表から引くと
 * 「表がその表と一致する」ことしか言わない。
 */
const EXPECTED_AGENT_NAMES: Record<Domain, string> = {
  'ic-card': '交通ICドメインエージェント',
  meeting: '会議ロジドメインエージェント',
  playground: '検証ドメインエージェント',
};

const TASK_DOMAINS: Record<TaskId, Domain> = {
  'ic-card.parse-reservation': 'ic-card',
  'meeting.parse-candidates': 'meeting',
  'meeting.parse-availability': 'meeting',
  'meeting.recommend-schedule': 'meeting',
  'playground.free-prompt': 'playground',
};

/**
 * taskId ごとの、入力契約を満たす `input`。
 *
 * **`getOrCreateDomainAgent` が受け取る第3引数**で、`playground.free-prompt` の
 * system prompt はここから来る（ADR-0020）。他4タスクでは使われないので、形だけを
 * 満たす必要も無い。
 */
const INPUTS: Record<TaskId, unknown> = {
  'ic-card.parse-reservation': undefined,
  'meeting.parse-candidates': undefined,
  'meeting.parse-availability': undefined,
  'meeting.recommend-schedule': undefined,
  'playground.free-prompt': { system_prompt: '持ち込みシステムプロンプト' },
};

/** 引数の数だけを埋める薄い包み。テストの読み手が `input` を毎回書かずに済む。 */
function createAgent(sessionId: string, taskId: TaskId) {
  return getOrCreateDomainAgent(sessionId, taskId, INPUTS[taskId]);
}

afterEach(clearWebSearchGateway);

describe('getOrCreateDomainAgent', () => {
  it.each(Object.entries(TASK_DOMAINS) as [TaskId, Domain][])(
    '%s は %s のドメインエージェントに解決される',
    (taskId, domain) => {
      const agent = createAgent(newSessionId(), taskId);

      expect(agent.name).toBe(EXPECTED_AGENT_NAMES[domain]);
      expect(domainOf(taskId)).toBe(domain);
    },
  );

  it('同じセッションと同じ taskId なら同じ Agent を返す', () => {
    const sessionId = newSessionId();

    expect(createAgent(sessionId, 'meeting.parse-candidates')).toBe(
      createAgent(sessionId, 'meeting.parse-candidates'),
    );
  });

  it('Gateway が設定されていると交通ICと検証ドメインが Web 検索を持つ', () => {
    useWebSearchGateway();

    // ツールの有無はドメインエージェントの違いのうち、名前と並んで唯一
    // 外から見えるもの（#46）。境界越しには現れないのでここで見る。
    const icCard = createAgent(newSessionId(), 'ic-card.parse-reservation');
    const meeting = createAgent(newSessionId(), 'meeting.parse-candidates');
    // 検索を使わせるプロンプトの効きを試せることがこの画面の値打ちの1つ（ADR-0020）。
    const playground = createAgent(newSessionId(), 'playground.free-prompt');

    expect(icCard.tools.map((tool) => tool.name)).toEqual(['web_search']);
    expect(playground.tools.map((tool) => tool.name)).toEqual(['web_search']);
    // #36 の「会議ロジにツールを1つも渡していない」は崩さない（F-22）。
    expect(meeting.tools).toEqual([]);
  });

  it('同じドメインでも taskId が違えば別の Agent になる', () => {
    const sessionId = newSessionId();

    // system prompt は taskId ごとに違い、Agent の生成時に固定される。
    // 使い回すと、同じセッションでタブを切り替えたときに前のタブの Skill が残る。
    expect(createAgent(sessionId, 'meeting.parse-candidates')).not.toBe(
      createAgent(sessionId, 'meeting.parse-availability'),
    );
  });
});
