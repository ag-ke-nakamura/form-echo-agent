import type { Agent } from '@strands-agents/sdk';
import type { FreePromptOutput, Usage } from '../contracts/index.js';
import type { InvocationLogger } from './logger.js';
import {
  limitStopDescription,
  MAX_AGENT_TURNS,
  usageOf,
} from './structured-output.js';

/**
 * Structured Output を通さずに**回答本文**を受け取る2本目の出力経路（ADR-0020）。
 *
 * WHY 通さないか: Strands の Structured Output はスキーマをツール仕様に変換して
 * モデルにツール呼び出しを強制する仕組みで、**素の system prompt の効きを見るという
 * プロンプト検証の目的そのものを歪める。** 既存4タブが全部あちらを通る以上、素の
 * 挙動と比べる基準線がどこかに要り、それがこの経路になる。
 *
 * 作り直しは無い。作り直しの理由（出力契約に適合しなかった）がこの経路には存在
 * しない — 契約は `{ text }` 1欄で、モデルが何を書いても適合する。
 *
 * 実行制限（往復回数・壁時計）は Structured Output の経路と同じものを共有する。
 */
export async function invokePlainText(
  agent: Agent,
  prompt: string,
  cancelSignal: AbortSignal,
  log: InvocationLogger,
): Promise<{ result: FreePromptOutput; usage: Usage }> {
  // 失敗したターンを履歴に残さない。残すとこのセッションの次のリクエストが必ず
  // 失敗する（`structured-output.ts` の作り直しが同じ理由で巻き戻している）。
  const snapshot = agent.takeSnapshot({ include: ['messages'] });
  let agentResult: Awaited<ReturnType<Agent['invoke']>>;
  try {
    agentResult = await agent.invoke(prompt, {
      cancelSignal,
      limits: { turns: MAX_AGENT_TURNS },
    });
  } catch (error) {
    agent.loadSnapshot(snapshot);
    throw error;
  }

  /*
    上限で切られた回は**投げる**。返すと、途中まで書かれたテキスト（多くは空文字）が
    成功として画面に出て、職員はそれをプロンプトの効きとして読む。

    **`PARSE_FAILED` にはしない**（ADR-0020）— あのコードが表すのは「出力契約に届か
    なかった」で、この経路には届かない出力が存在しない。握り潰さずに投げれば handler
    が 500 にし、BFF が RUNTIME_UNAVAILABLE に写す。運用側が要る「どの上限で切ったか」
    は下の warn ログが持つ。
  */
  const limitStop = limitStopDescription(agentResult.stopReason);
  if (limitStop !== null) {
    log.warn(
      { stopReason: agentResult.stopReason },
      `実行制限で打ち切りました: ${limitStop}`,
    );
    agent.loadSnapshot(snapshot);
    throw new Error(limitStop);
  }

  /*
    テキストのブロックだけを繋ぐ。`AgentResult.toString()` は reasoning と citations の
    ブロックも混ぜるので使わない — **回答本文**（`CONTEXT.md`）はモデルが職員へ向けて
    書いた文であって、思考の途中経過ではない。
  */
  const text = agentResult.lastMessage.content
    .map((block) => (block.type === 'textBlock' ? block.text : ''))
    .join('');

  return { result: { text }, usage: usageOf(agentResult) };
}
