import {
  type Agent,
  StructuredOutputError as ModelRefusedToolError,
} from '@strands-agents/sdk';
import type { z } from 'zod';
import type { Usage } from '../contracts/index.js';
import type { InvocationLogger } from './logger.js';

/**
 * Structured Output が出力契約に適合しなかったときの試行回数の上限。
 * 参照ドキュメント 6.3節の「1回目失敗 → 再試行、2回目失敗 → エラー」に対応する。
 */
const MAX_STRUCTURED_OUTPUT_ATTEMPTS = 2;

/** 出力契約に適合した結果が得られなかったことを表す。BFF へ PARSE_FAILED を返す。 */
export class StructuredOutputError extends Error {}

/**
 * この失敗を作り直しに乗せるか。
 *
 * 乗せるのは**モデルは応答したが出力契約に届かなかった**ものだけ。Strands の
 * `StructuredOutputError` は「ツールの使用を強制してもモデルが呼ばなかった」を表し、
 * スキーマ検査の失敗（`safeParse`）と同じくモデルの書き方の問題である。
 *
 * WHY: モデル呼び出しそのものの失敗（Bedrock に届かない、スロットリング、
 * コンテキスト超過）を混ぜない。作り直しても同じところで落ちるだけの上、
 * PARSE_FAILED として返ると**画面の案内が変わる** — 参照ドキュメント 9.3節は
 * Runtime 障害に「手動で入力してください」を出させるが、パース失敗の文言
 * （「読み取れませんでした」）が出て、職員は同じ入力を打ち直す。握り潰さずに
 * 投げ直せば handler が 500 にし、BFF が RUNTIME_UNAVAILABLE に写す。
 */
function isRetryable(error: unknown): boolean {
  return error instanceof ModelRefusedToolError;
}

export async function invokeWithSchemaRetry(
  agent: Agent,
  prompt: string,
  schema: z.ZodType,
  log: InvocationLogger,
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
      const agentResult = await agent.invoke(prompt, {
        structuredOutputSchema: schema,
      });
      const parsed = schema.safeParse(agentResult.structuredOutput);
      if (parsed.success) {
        // この1回の呼び出し分だけを返す。accumulatedUsage は Agent の生涯合計で、
        // セッションを跨いで再利用されると2ターン目以降が積み上がった値になる。
        const usage = agentResult.metrics?.latestAgentInvocation?.usage;
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
      if (!isRetryable(error)) {
        // 履歴は戻してから投げる。戻さないと失敗したターンがキャッシュされた
        // Agent に残り、このセッションの次のリクエストが必ず失敗する。
        agent.loadSnapshot(snapshot);
        throw error;
      }
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
