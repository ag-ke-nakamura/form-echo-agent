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
};

const TASK_DOMAINS: Record<TaskId, Domain> = {
  'ic-card.parse-reservation': 'ic-card',
  'meeting.parse-candidates': 'meeting',
  'meeting.parse-availability': 'meeting',
  'meeting.recommend-schedule': 'meeting',
};

afterEach(clearWebSearchGateway);

describe('getOrCreateDomainAgent', () => {
  it.each(Object.entries(TASK_DOMAINS) as [TaskId, Domain][])(
    '%s は %s のドメインエージェントに解決される',
    (taskId, domain) => {
      const agent = getOrCreateDomainAgent(newSessionId(), taskId);

      expect(agent.name).toBe(EXPECTED_AGENT_NAMES[domain]);
      expect(domainOf(taskId)).toBe(domain);
    },
  );

  it('同じセッションと同じ taskId なら同じ Agent を返す', () => {
    const sessionId = newSessionId();

    expect(getOrCreateDomainAgent(sessionId, 'meeting.parse-candidates')).toBe(
      getOrCreateDomainAgent(sessionId, 'meeting.parse-candidates'),
    );
  });

  it('Gateway が設定されていると交通ICだけが Web 検索を持つ', () => {
    useWebSearchGateway();

    // ツールの有無はドメインエージェントの違いのうち、名前と並んで唯一
    // 外から見えるもの（#46）。境界越しには現れないのでここで見る。
    const icCard = getOrCreateDomainAgent(
      newSessionId(),
      'ic-card.parse-reservation',
    );
    const meeting = getOrCreateDomainAgent(
      newSessionId(),
      'meeting.parse-candidates',
    );

    expect(icCard.tools.map((tool) => tool.name)).toEqual(['web_search']);
    expect(meeting.tools).toEqual([]);
  });

  it('同じドメインでも taskId が違えば別の Agent になる', () => {
    const sessionId = newSessionId();

    // 明示モードでは system prompt が taskId ごとに違い、Agent の生成時に固定される。
    // 使い回すと、同じセッションでタブを切り替えたときに前のタブの Skill が残る。
    expect(
      getOrCreateDomainAgent(sessionId, 'meeting.parse-candidates'),
    ).not.toBe(getOrCreateDomainAgent(sessionId, 'meeting.parse-availability'));
  });
});
