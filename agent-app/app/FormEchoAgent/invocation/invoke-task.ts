import { resolveAgentLoopTimeoutMs } from '../config.js';
import {
  inspectedInputStrings,
  outputSchemaFor,
  parseReservationOutputSchema,
  type TaskId,
  type Usage,
} from '../contracts/index.js';
import { checkGuardrail } from '../guardrail/load.js';
import { GuardrailBlockedError } from '../guardrail/types.js';
import type { WebSearchHit } from '../tools/web-search.js';
import {
  toCitations,
  webSearchesUsed,
  webSearchHits,
  withWebSearchBudget,
} from '../tools/web-search.js';
import { discardSession, getOrCreateDomainAgent } from './domain-agent.js';
import type { InvocationLogger } from './logger.js';
import { invokeWithSchemaRetry } from './structured-output.js';
import { buildUserMessage } from './user-message.js';

export { GuardrailBlockedError } from '../guardrail/types.js';
// 失敗の型もシーム越しに見せる。ハンドラが境界の内側を直接掴まないため。
export { StructuredOutputError } from './structured-output.js';

/** invocation 境界への入力。BFF が送るリクエストのうち Runtime が処理に使う分。 */
export interface TaskInvocation {
  taskId: TaskId;
  /** 職員が書いた自然文。推薦系では省略できる（ADR-0004）。 */
  prompt?: string | null;
  /**
   * 構造化入力。`INPUT_SCHEMAS` で検査済みのものを受け取る。
   *
   * **追加の指示のときも毎回届く。** Agent キャッシュはベストエフォートで、
   * コールドスタートで会話履歴ごと消える（`domain-agent.ts`）。初回だけ送る形に
   * すると、履歴が消えた後の2回目が「表の無いリクエスト」になり、AI は評点を
   * 付ける対象を持たないまま実行させられる。
   */
  input?: unknown;
  /**
   * AgentCore のセッション ID。会話履歴の帰属先を決める。
   *
   * リクエスト本文の `sessionId` ではなく、AgentCore が確定させた
   * `RequestContext.sessionId` を渡す（初回は本文側が null になるため）。
   */
  sessionId: string;
}

/** invocation 境界からの出力。ハンドラが `sessionId` を添えて応答本文にする。 */
export interface TaskInvocationResult {
  result: unknown;
  usage: Usage;
  /**
   * このリクエストが使った Web 検索の回数（#46）。Web 検索を持たないドメインでは 0。
   *
   * 応答本文には載せない。職員に見せる数字ではなく、実測とログのためのもの。
   */
  webSearches: number;
  /**
   * このリクエストでモデルへ渡した検索結果（#46）。
   *
   * **ここで返すのは、予算の実行文脈が `invokeTask` を抜けた時点で消えるため。**
   * 呼び出し側から `webSearchHits()` を読んでも空になる。実測が「答えが検索結果に
   * 紐づいているか」を突き合わせるのに要る — 後から同じクエリを投げ直しても、
   * 検索結果は毎回同じではないので突き合わせにならない。
   */
  webSearchHits: readonly WebSearchHit[];
}

/**
 * Runtime の invocation 境界。
 *
 * 検査済みの `{taskId, prompt, input, sessionId}` から出力契約に適合した構造化
 * データを作る。ドメインエージェントの選択、Agent キャッシュ、Skill の読み込み、
 * Structured Output の再試行はすべてこの関数から辿れる位置にある。
 *
 * WHY: エントリポイントから切り離してあるのは、ドメインとエラー経路が増えるほど
 * `main.ts` が肥大するため。Guardrail チェックの2経路、Skill 選択の2モード、
 * 出力側の再検査もこの内側に足す。テストと実測はこの境界を利用する側であり、
 * 差し替えるのは設定（モデル・Guardrail の実装）だけにする。
 *
 * 失敗は例外で表す。出力契約のエラーコードへの写像はハンドラが持つ。
 */
export async function invokeTask(
  { taskId, prompt, input, sessionId }: TaskInvocation,
  log: InvocationLogger,
): Promise<TaskInvocationResult> {
  const agent = getOrCreateDomainAgent(sessionId, taskId);
  /*
    実行制限の壁時計をここで1つ作る（#125）。**Web 検索の予算と同じ理由で
    invocation 全体を包む必要がある** — `agent.invoke` ごとに作ると、`limits` の
    カウンタが試行ごとにリセットされるのと同じく、作り直しの2試行がそれぞれ満額の
    時間を得る。入口で作るので Guardrail の往復に使った時間もこの予算から引かれる
    （**Guardrail 自身は signal を受け取らないので、その呼び出しの途中では切れない**）。
  */
  const cancelSignal = AbortSignal.timeout(resolveAgentLoopTimeoutMs());
  /*
    Web 検索の予算をここで張る（#46）。**上限はリクエスト単位**（共通設計方針書
    7.1節）なので、`invokeWithSchemaRetry` の作り直しを含めた全体を包む必要がある。
    内側に張ると、Structured Output が1回失敗しただけで残高が戻る。
    Web 検索を持たないドメインでは誰も引かないので、ここに分岐は要らない。
  */
  return withWebSearchBudget(async () => {
    /*
      検査するのは**人が書いた文字列**であって `prompt` か `input` かではない
      （ADR-0017）。どれが人の書いた文かは `inspectedInputStrings` が taskId ごとに
      持つ — 交通ICの出発地・目的地が対象で、会議3タブの与件は対象外である。

      モデル呼び出しの前に検査する（ADR-0001）。ブロック時にモデルのトークンを
      消費しない。
    */
    const inspected = inspectedInputText(taskId, prompt, input);
    if (inspected !== '') {
      await blockOrPass(inspected, 'INPUT', sessionId, log);
    }

    // 履歴の巻き戻しは invokeWithSchemaRetry が試行ごとに行うので、ここでは持たない。
    const invoked = await invokeWithSchemaRetry(
      agent,
      buildUserMessage(taskId, prompt, input),
      // 入力を見ないと言えない不変条件（提案が入力の候補日程と過不足なく対応して
      // いるか）もここに載せる。値域を外れた評点と同じく作り直しに回す。
      outputSchemaFor(taskId, input),
      cancelSignal,
      log,
    );

    /*
      出力側の検査（F-16）。Strands の Structured Output はスキーマをツール仕様に
      変換して実装されているため、Guardrail の sensitive information filter は
      toolUse.input を評価せず、抽出結果に載ったマイナンバー等を見ない。パース
      直後にアプリケーション層でここへ通す。
    */
    await blockOrPass(JSON.stringify(invoked.result), 'OUTPUT', sessionId, log);

    warnOnUnresolvableCitations(taskId, invoked.result, log);

    // 予算の内側で読む。外へ出ると `AsyncLocalStorage` の文脈が切れて空になる。
    return {
      ...invoked,
      webSearches: webSearchesUsed() ?? 0,
      webSearchHits: webSearchHits(),
    };
  });
}

/**
 * 経路候補が指した出典番号が、このリクエストで取得した出典の範囲に無いことを記録する
 * （#174、ADR-0019）。**弾かない。**
 *
 * WHY 記録するか: 番号方式では範囲外は「モデルが数字を作った」というまれで機械的な
 * 失敗で、**画面はその候補を「確認できませんでした」と出して残りを描く**（番号1つの
 * ために応答全体を捨てるのは釣り合わない）。記録が無いと、それが起きていること自体に
 * 気付けず、Skill の書き方を直す材料も得られない。
 *
 * 予算の内側から呼ぶ（`webSearchHits()` が `AsyncLocalStorage` を読む）。
 *
 * **見るのは件数の範囲だけ。** 画面は http(s) 以外の出典を落とすので（`linkableSources`）、
 * そこを指した番号も引けないが、その判定を持ち込むと表示の規則が Runtime にも複製される。
 * 検索コネクタが http(s) 以外を返す回は無いという前提の側に倒す。
 */
function warnOnUnresolvableCitations(
  taskId: TaskId,
  result: unknown,
  log: InvocationLogger,
): void {
  /*
    taskId で分岐するが、この判断を契約の表（`inspectedInputStrings` のような形）に
    しない。**契約が持つのは「何を受け付け何で検査するか」で、これはログを出すかどうか
    である。** 出典番号を持つのは Web 検索を持つドメインだけなので、表にしても
    交通IC以外の行は永久に空になる。
  */
  if (taskId !== 'ic-card.parse-reservation') return;
  // `result` を出力契約でもう一度読む（`invokeWithSchemaRetry` の戻りは `unknown`）。
  // 契約に適合しない `result` はここへ来ない（作り直しか PARSE_FAILED になる）。
  const parsed = parseReservationOutputSchema.safeParse(result);
  if (!parsed.success) return;
  const available = toCitations(webSearchHits()).length;
  const unresolvable = parsed.data.route_candidates
    .map((candidate) => candidate.citation_number)
    .filter((number) => number > available);
  if (unresolvable.length === 0) return;
  log.warn(
    { citationNumbers: unresolvable, available },
    '経路候補が取得していない出典番号を指しました',
  );
}

/**
 * Guardrail の入力側で検査する1本のテキスト（#170）。
 *
 * **欄ごとに検査せず連結して1回**にする（ADR-0017）。呼ぶ回数が増えないだけでなく、
 * **欄を跨いだ注入**（出発地に前半・追加指示に後半を書く）が捕まる — 欄ごとに
 * 検査すると、どちらの断片も単体では判定に届かず素通りする。ブロック時の文言は
 * 欄名を含まないので（ADR-0009）、どの欄が原因かを分ける必要は無い。
 *
 * **`buildUserMessage` が組んだ本文は検査しない。** あれには我々が書いた足場の文言と
 * 与件の JSON まで入るので、検査対象に「システムが組み立てたもの」が混ざり、会議3タブ
 * まで巻き込む（ADR-0004 が避けた「何を検査しているのか曖昧になる」状態そのもの）。
 *
 * 空の欄は落とす。全部空なら空文字列を返し、呼び出し側は検査そのものを省く —
 * 検査すべき人の文が1文字も無い回に、Guardrail の往復を1つ増やす理由が無い。
 */
function inspectedInputText(
  taskId: TaskId,
  prompt: string | null | undefined,
  input: unknown,
): string {
  return [prompt ?? '', ...inspectedInputStrings(taskId, input)]
    .filter((text) => text.trim() !== '')
    .join('\n');
}

/**
 * Guardrail に通し、ブロックならセッションを破棄して投げる。
 *
 * WHY セッションを破棄するか: ブロック対象のテキストが会話履歴に残ると、以降の
 * 正常なメッセージまで連鎖的にブロックし続ける（F-14）。ここで断つことで、
 * 参照ドキュメント 11.2節の「3回連続ブロック」が真の再ブロックだけを数えるように
 * なる。
 */
async function blockOrPass(
  text: string,
  direction: 'INPUT' | 'OUTPUT',
  sessionId: string,
  log: InvocationLogger,
): Promise<void> {
  const verdict = await checkGuardrail(text, direction);
  if (!verdict.blocked) return;
  log.warn(
    { direction, findings: verdict.findings },
    'Guardrail がブロックしました',
  );
  discardSession(sessionId);
  throw new GuardrailBlockedError(verdict);
}
