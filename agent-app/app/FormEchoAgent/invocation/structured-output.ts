import {
  type Agent,
  StructuredOutputError as ModelRefusedToolError,
  type StopReason,
} from '@strands-agents/sdk';
import type { z } from 'zod';
import type { Usage } from '../contracts/index.js';
import type { InvocationLogger } from './logger.js';

/**
 * Structured Output が出力契約に適合しなかったときの試行回数の上限。
 * 参照ドキュメント 6.3節の「1回目失敗 → 再試行、2回目失敗 → エラー」に対応する。
 */
const MAX_STRUCTURED_OUTPUT_ATTEMPTS = 2;

/**
 * 1回の `agent.invoke` に許す往復回数の上限（#125）。
 *
 * 内側のループ（Strands 自身。スキーマ検査の失敗を LLM 向けの検証エラーとして
 * ツール結果で返し、同じ `agent.invoke` の次ターンにする）には SDK 側の上限が無い。
 * 張らないと、契約に届かない出力を返し続けるモデルが AgentCore Runtime の同期
 * タイムアウト（15分）まで回る。
 *
 * 値の根拠（#121 の実測。`docs/reference-doc-fixes.md` F-10 の追測節）:
 * Structured Output に要した往復は Sonnet が 8/8 件で1往復、Haiku が 5/8 件で2往復。
 * これに Web 検索の3回（`WEB_SEARCH_MAX_CALLS`。1回の検索が1往復を使う）を足した
 * 5往復が正常系の上限で、実測が8件しかないぶんの余裕を足して倍の10とする。
 * **`WEB_SEARCH_MAX_CALLS` から式で導かない** — 検索の予算を絞ったときに往復の上限が
 * 黙って縮むし、Web 検索を持たない会議ロジの上限まで一緒に動く。
 *
 * **`limits.outputTokens` / `limits.totalTokens` は張らない。** どちらもソフト
 * キャップで、単発の巨大応答は超過したまま返る（SDK の `InvokeOptions` が明記して
 * いる）ので「塞いだつもりで塞げていない」状態になる。加えて上限値を決める根拠
 * （異常系のトークン分布）を我々は持っていない。壁時計（`cancelSignal`）の方が
 * 効き方を言い切れる。
 */
const MAX_AGENT_TURNS = 10;

/** 出力契約に適合した結果が得られなかったことを表す。BFF へ PARSE_FAILED を返す。 */
export class StructuredOutputError extends Error {}

/**
 * 職員に見せる文言。**実行制限で打ち切った場合も同じものを使う。**
 *
 * 職員が取る行動（入力を書き直してもう一度試す）が作り直しの尽きた場合と同じで、
 * 上限で切ったことは職員には行動の変わらない情報である。運用側が要る区別は
 * `stopReason` の warn ログが持つ。
 */
const PARSE_FAILED_MESSAGE = 'Structured Output が出力契約に適合しませんでした';

/**
 * 実行制限で打ち切られた理由の説明。上限に達していなければ null。
 *
 * WHY 既定の分岐を持つか: `StopReason` は `(string & {})` を含むユニオンなので
 * 網羅性チェックが効かない。列挙し忘れても型では気付けないため、既定は
 * 「打ち切りではない」に倒す — SDK が理由を増やしたときに、正常な停止理由が
 * 黙って「上限で切った」に化ける方が危ない。
 */
function limitStopDescription(stopReason: StopReason): string | null {
  switch (stopReason) {
    case 'limitTurns':
      return `1回の呼び出しの往復回数の上限（${MAX_AGENT_TURNS}）に達しました`;
    case 'cancelled':
      return 'Runtime 側のタイムアウトに達しました';
    default:
      return null;
  }
}

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
  /**
   * リクエスト単位の壁時計。**呼び出し側が1つ作って渡す。**
   *
   * WHY ここで作らないか: `limits` のカウンタは `agent.invoke` ごとにリセットされる
   * （SDK の `InvokeOptions` が明記している）ので、往復回数の上限は下の2試行が
   * それぞれ満額の予算を得る。壁時計だけはリクエスト単位で効かせないと、
   * 実質2倍の時間を使えることになる。
   */
  cancelSignal: AbortSignal,
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
        cancelSignal,
        limits: { turns: MAX_AGENT_TURNS },
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
      /*
        適合しなかったときだけ停止理由を見る。**この順序は逆にしない** — 上限は
        「前のターンが要求したツールを走り切ってから」効くので、適合済みの結果が
        載った回にも立ちうる（現在の SDK は Structured Output を掴んだ時点で即
        返すため起きないが、その内側の事情に依存しない）。

        上限で切られた場合は作り直しに回さず抜ける。回しても壁時計は戻らないので
        `cancelled` は即座に同じ結果になり、`limitTurns` の方はカウンタが戻るぶん
        予算を2倍に使う。どちらも意味が無い。
      */
      const limitStop = limitStopDescription(agentResult.stopReason);
      if (limitStop !== null) {
        // 運用側は「契約に適合しなかった」と「上限で切った」を区別する必要がある。
        // エラーコードは同じ PARSE_FAILED なので、区別はこのログが担う。
        log.warn(
          { stopReason: agentResult.stopReason, attempt },
          `実行制限で打ち切りました: ${limitStop}`,
        );
        lastFailure = new Error(limitStop);
        agent.loadSnapshot(snapshot);
        break;
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
  throw new StructuredOutputError(PARSE_FAILED_MESSAGE, {
    cause: lastFailure,
  });
}
