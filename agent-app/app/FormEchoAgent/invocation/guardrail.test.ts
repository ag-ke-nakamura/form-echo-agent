import { describe, expect, it } from 'vitest';
import type { AiTaskRequest } from '../contracts/index.js';
import { fakeGuardrailScript } from '../guardrail/fake.js';
import { fakeModelScript } from '../model/fake.js';
import {
  expectError,
  expectSuccess,
  invokeBoundary,
  newSessionId,
  userMessagesOf,
} from '../tests/harness.js';

/**
 * Guardrail の配線（#43）。invocation 境界の側から見えるのは、ブロックが
 * GUARDRAIL_BLOCKED になること・モデル呼び出しの前後どちらでも効くこと・
 * ブロック後に連鎖しないこと（F-14）だけ。判定そのもの（しきい値・レスポンスの
 * 解釈）は `guardrail/*.test.ts` が見る。
 */

/** 交通ICの与件（#168）。往復区分は「移動の条件」で職員が選ぶ。 */
const RESERVATION_INPUT = {
  round_trip: { value: 'round', is_manual: false },
} as const;

const REQUEST: AiTaskRequest = {
  taskId: 'ic-card.parse-reservation',
  prompt: '来月15日から3泊4日で大阪出張、新幹線で往復',
  input: RESERVATION_INPUT,
};

const VALID_OUTPUT = {
  borrow_at: '2026-10-15',
  return_at: '2026-10-18T18:00',
  origin: '東京',
  destination: '大阪',
  round_trip: 'round',
  purpose: 'business_trip',
  companion_count: null,
  route_candidates: [
    {
      route: '東京(東海道新幹線) => 大阪',
      fare: '14720円',
      duration: '2時間30分',
      transfer_count: 0,
      is_selected: true,
      reason: '運賃が最安',
      commuter_pass_overlap_sections: null,
    },
  ],
  message: '借りる日・返す日時・目的地・利用目的を読み取りました。',
  sources: [],
};

const BLOCKED = {
  blocked: true,
  findings: [
    {
      checkType: 'promptAttack' as const,
      detail: 'JAILBREAK(1)',
      source: 'strategy' as const,
    },
  ],
};

describe('Guardrail', () => {
  it('入力がブロックされると GUARDRAIL_BLOCKED になり、モデルを呼ばない', async () => {
    fakeGuardrailScript.write(BLOCKED);

    const response = await invokeBoundary(REQUEST);

    expect(expectError(response).code).toBe('GUARDRAIL_BLOCKED');
    expect(fakeModelScript.calls).toHaveLength(0);
  });

  it('出力がブロックされても GUARDRAIL_BLOCKED になる', async () => {
    fakeModelScript.write({ kind: 'structuredOutput', output: VALID_OUTPUT });
    // 1手目（入力側）は通し、2手目（出力側）でブロックする。
    fakeGuardrailScript.write({ blocked: false, findings: [] }, BLOCKED);

    const response = await invokeBoundary(REQUEST);

    expect(expectError(response).code).toBe('GUARDRAIL_BLOCKED');
  });

  it('ブロック後、同じセッションで送った正常なメッセージは連鎖ブロックしない（F-14）', async () => {
    const sessionId = newSessionId();
    fakeModelScript.write(
      { kind: 'structuredOutput', output: VALID_OUTPUT },
      { kind: 'structuredOutput', output: VALID_OUTPUT },
    );
    // 1回目: 入力は通すが出力をブロックする（会話履歴に PII 入りの応答が残る経路）。
    fakeGuardrailScript.write({ blocked: false, findings: [] }, BLOCKED);

    const blockedResponse = await invokeBoundary(REQUEST, sessionId);
    expect(expectError(blockedResponse).code).toBe('GUARDRAIL_BLOCKED');
    expect(fakeModelScript.calls).toHaveLength(1);

    // 2回目: 台本を使い切ったので既定（ブロックしない）に戻る。
    const followUp = '往路は16日でした';
    const secondResponse = await invokeBoundary(
      {
        taskId: 'ic-card.parse-reservation',
        prompt: followUp,
        input: RESERVATION_INPUT,
      },
      sessionId,
    );

    expectSuccess(secondResponse);
    // セッションが破棄されていれば、2回目にモデルへ届く user メッセージは
    // 今回の1件だけになる。破棄されていなければ、1回目の（ブロックされた）
    // 指示も履歴に残ったまま積まれる。
    const messages = userMessagesOf(fakeModelScript.calls[1]);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain(followUp);
  });
});
