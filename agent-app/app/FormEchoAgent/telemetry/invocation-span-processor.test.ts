import type { Span } from '@opentelemetry/sdk-trace-base';
import { describe, expect, it } from 'vitest';
import { withInvocationAttributes } from './invocation-attributes.js';
import { invocationSpanProcessor } from './invocation-span-processor.js';

/**
 * span に invocation の値を貼る処理（#213）。
 *
 * **invocation 境界の外から確かめるしかない**（`.claude/rules/formecho-agent-testing.md`
 * の例外その4と同じ理由）。貼り忘れても応答は成功のままで、**コンソールの
 * セッション画面が静かに空になるだけ**なので、境界の出力には何も現れない。
 */

/** 貼られた属性を記録するだけの span。`setAttribute` しか使わない。 */
function recordingSpan(): Span & { recorded: Record<string, unknown> } {
  const recorded: Record<string, unknown> = {};
  return {
    recorded,
    setAttribute(key: string, value: unknown) {
      recorded[key] = value;
      return this;
    },
  } as unknown as Span & { recorded: Record<string, unknown> };
}

describe('invocation の値を span に貼る', () => {
  it('セッションと taskId を貼る', async () => {
    const span = recordingSpan();

    await withInvocationAttributes(
      { sessionId: 'session-1', taskId: 'ic-card.parse-reservation' },
      async () => {
        invocationSpanProcessor.onStart(span);
      },
    );

    expect(span.recorded).toEqual({
      'session.id': 'session-1',
      'formecho.task_id': 'ic-card.parse-reservation',
    });
  });

  /*
    AgentCore サービス側の span が持つ `aws.request.id` とは**揃わない**ことを
    実機で確認している（ヘッダが届かず SDK がランダム UUID を入れる）。無関係な値を
    予約キーに入れると後で結合しようとした人を誤らせるので、貼らないことを固定する。
  */
  it('aws.request.id は貼らない', async () => {
    const span = recordingSpan();

    await withInvocationAttributes(
      { sessionId: 'session-1', taskId: 'playground.free-prompt' },
      async () => {
        invocationSpanProcessor.onStart(span);
      },
    );

    expect(span.recorded).not.toHaveProperty('aws.request.id');
  });

  /*
    起動時や invocation の外で誰かが span を張ることはありうる。ここで投げると
    **トレースを出したいだけでリクエストを落とす**ので、黙って何もしない。
  */
  it('invocation の外では何も貼らず、投げない', () => {
    const span = recordingSpan();

    expect(() => invocationSpanProcessor.onStart(span)).not.toThrow();
    expect(span.recorded).toEqual({});
  });

  /*
    文脈は非同期の境界を越えて保たれる必要がある。モデル呼び出しもツール実行も
    await の先で span を張るので、ここが切れると親 span にしか貼られない
    （Strands の `traceAttributes` と同じ穴に戻る）。
  */
  it('await をまたいでも貼り続ける', async () => {
    const span = recordingSpan();

    await withInvocationAttributes(
      { sessionId: 'session-2', taskId: 'meeting.parse-candidates' },
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        invocationSpanProcessor.onStart(span);
      },
    );

    expect(span.recorded['session.id']).toBe('session-2');
    expect(span.recorded['formecho.task_id']).toBe('meeting.parse-candidates');
  });
});
