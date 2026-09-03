"use client";

import type { TaskId } from "@contracts/index.js";
/*
  値として引くのはこの1モジュールだけ。`index.js` から引くと zod がバンドルに乗る
  （他の import はすべて `import type` なので実行時には消える）。拡張子を付けないのは、
  型としてしか使わない import と違ってバンドラが実際に解決するため — `.js` を付けると
  `.ts` の実体を見つけられない。
*/
import { isPromptRequired } from "@contracts/prompt-requirement";
import { useEffect, useId, useRef, useState } from "react";
import type { ApplyReport } from "./field-source";
import { formSectionId } from "./form-section";
import { requestAiTask, type TaskOutputs } from "./lib/api";
import { type ErrorGuidance, errorGuidanceFor } from "./lib/error-guidance";

/**
 * 会話ログの1往復。職員が送った指示と、それに対する結果を対で持つ。
 *
 * 失敗した往復もログに残す。消してしまうと、指示が Runtime に届かなかったのか、
 * 届いた上でフォームが変わらなかったのかが区別できなくなる。
 */
type Turn = { id: string; prompt: string } & (
  | { ok: true; message: string; report: ApplyReport }
  | { ok: false; guidance: ErrorGuidance }
);

type AiChatPanelProps<TTaskId extends TaskId> = {
  taskId: TTaskId;
  description: string;
  /**
   * 非AI経路でこのタブの何ができるかの一文。AI が使えないときに導線へ添える。
   *
   * WHY: タブごとに書けることが違う。参加可否タブは候補日程が空だと付ける対象が
   * 無く、先に「会議候補日設定」タブへ回る必要がある — ここを共通の
   * 「すべての項目を埋められます」で済ませると、空のフォームへ運んだ先で嘘になる。
   */
  nonAiPathHint: string;
  /** 初回の指示の例。 */
  placeholder: string;
  /**
   * 構造化入力（ADR-0004）。持つ taskId では**毎回そのまま送り直す**。
   *
   * WHY: Runtime 側の会話履歴はコールドスタートで消えるので、初回だけ送ると
   * 履歴が消えた後の追加の指示が「表の無いリクエスト」として届く。
   */
  input?: unknown;
  /**
   * 初回の送信ボタンの文言。自然文が必須でないタブでは「フォームを埋める」が
   * 実態と合わない（職員はまだ何も書いていない）。
   */
  submitLabel?: string;
  /** 追加の指示の例。初回とは書くことが違うので別に持つ。 */
  followUpPlaceholder: string;
  /** 結果をフォームへ写し、何を更新して何を守ったかを返す。 */
  onResult: (result: TaskOutputs[TTaskId]) => ApplyReport;
  /** このタブのフォームを初期状態へ戻す。 */
  onReset: () => void;
};

/**
 * 全タブで共有する AI チャット欄。
 *
 * WHY: タブごとに違うのは `taskId` と文言だけで、経路も表示も同じにする。
 * 「同じチャット欄が taskId を切り替えて違う結果を返す」という参照アーキテクチャの
 * 構造を、画面の実物として見えるようにするため。
 *
 * 会話ログの形にしたのは #38 の判断。単一のテキストエリアに出し直す形だと、
 * セッションが続いていること自体が画面から見えない（送った指示も前の応答も残らない）。
 * `sessionId` をタブごとにここで持つ理由も同じで、タブは別々の会話として進む。
 */
export function AiChatPanel<TTaskId extends TaskId>({
  taskId,
  description,
  nonAiPathHint,
  placeholder,
  followUpPlaceholder,
  input,
  submitLabel = "フォームを埋める",
  onResult,
  onReset,
}: AiChatPanelProps<TTaskId>) {
  const [prompt, setPrompt] = useState("");
  const [pending, setPending] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);

  const promptId = useId();
  const nextTurnNumber = useRef(0);

  /**
   * 自然文が要るかどうかは契約の表から引く（ADR-0004）。
   *
   * 画面側で「このタブは任意」と書き写さない。書き写すと、契約が taskId の必須性を
   * 変えたときに送信ボタンだけが古い判断のまま残り、押せるのに BFF が弾く（または
   * 押せないまま送れない）状態になる。
   */
  const promptRequired = isPromptRequired(taskId);

  /**
   * 送信ごとの連番。
   *
   * WHY: 応答を待っている間に「最初からやり直す」が押されても、飛んでいる
   * リクエストは止まらない。番号で照合せずに結果を書き込むと、空にしたはずの
   * フォームが数秒後に埋まり、消した会話ログに1往復だけ現れる。
   */
  const submitSerial = useRef(0);

  /**
   * 最新の `onResult` / `onReset`。
   *
   * WHY: 応答を待っている間に職員がフォームを触ると親が再レンダーされるが、実行中の
   * `handleSubmit` のクロージャは古い prop を掴んだままになる。古い `onResult` は
   * 編集前のフォーム状態を見て上書きの可否を決めるので、**待っている間の手入力を
   * AI 由来と誤認して踏み潰す**。「手入力は上書きしない」を守るには、写す時点で
   * 最新の状態を見ている関数を呼ぶ必要がある。
   */
  const handlers = useRef({ onResult, onReset });
  useEffect(() => {
    handlers.current = { onResult, onReset };
  }, [onResult, onReset]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const sent = prompt.trim();
    if (pending) return;
    if (promptRequired && sent === "") return;
    const serial = ++submitSerial.current;
    setPending(true);

    const outcome = await requestAiTask({
      taskId,
      // 空文字ではなく null で送る。BFF から見て「書かれなかった」と
      // 「空を書いた」を区別する必要はなく、契約は任意フィールドの欠落で表す。
      prompt: sent === "" ? null : sent,
      sessionId,
      input,
    });
    // 待っている間にやり直されていたら、この結果は捨てる（`pending` は
    // `handleReset` が下ろしている）。
    if (serial !== submitSerial.current) return;

    const id = `turn-${nextTurnNumber.current++}`;

    if (outcome.ok) {
      setSessionId(outcome.sessionId);
      // setTurns の updater の外で呼ぶ。updater は純粋に保つ約束があり、中で
      // フォームを書き換えると StrictMode の二重呼び出しで二重に反映される。
      const report = handlers.current.onResult(outcome.result);
      setTurns((current) => [
        ...current,
        { id, prompt: sent, ok: true, message: outcome.result.message, report },
      ]);
      setPrompt("");
    } else {
      // 失敗しても sessionId は捨てない。会話は Runtime 側に残っているので、
      // 書き直して送れば続きとして届く。
      setTurns((current) => [
        ...current,
        {
          id,
          prompt: sent,
          ok: false,
          guidance: errorGuidanceFor(outcome.code),
        },
      ]);
      // 失敗したときは書いたものを残す。INVALID_INPUT のように**書き直して
      // もらう**エラーがあるので、消すと言い直しのために全部打ち直しになる。
    }

    setPending(false);
  }

  function handleReset() {
    // 番号を進めて、飛んでいるリクエストの結果を無効にする。
    submitSerial.current++;
    setPending(false);
    setTurns([]);
    setSessionId(null);
    setPrompt("");
    handlers.current.onReset();
  }

  const continuing = sessionId !== null;
  // 初回が失敗するとセッションは始まらないが、失敗した往復はログに残る。
  // やり直したいのはまさにその場面なので、ログがあれば操作を出す。
  const resettable = continuing || turns.length > 0;

  return (
    <section className="rounded-lg border border-black/10 p-6 dark:border-white/15">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h2 className="text-lg font-semibold">AI チャット</h2>
        {continuing && (
          <span className="text-xs text-black/55 dark:text-white/55">
            会話を継続中（{turns.length}往復）
          </span>
        )}
      </div>
      <p className="mt-1 text-sm text-black/60 dark:text-white/60">
        {description}
      </p>

      {turns.length > 0 && (
        <ol aria-live="polite" className="mt-4 grid gap-4">
          {turns.map((turn) => (
            <li key={turn.id}>
              <TurnView
                turn={turn}
                taskId={taskId}
                nonAiPathHint={nonAiPathHint}
              />
            </li>
          ))}
        </ol>
      )}

      <form onSubmit={handleSubmit} className="mt-4">
        <label htmlFor={promptId} className="sr-only">
          {continuing ? "AI への追加の指示" : "AI への指示"}
        </label>
        <textarea
          id={promptId}
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          rows={continuing ? 3 : 5}
          placeholder={continuing ? followUpPlaceholder : placeholder}
          className="w-full rounded-md border border-black/15 bg-transparent p-3 text-sm dark:border-white/20"
        />
        <button
          type="submit"
          disabled={pending || (promptRequired && prompt.trim() === "")}
          className="mt-3 w-full rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-40"
        >
          {pending ? "生成中…" : continuing ? "追加の指示を送る" : submitLabel}
        </button>
      </form>

      {resettable && (
        <div className="mt-4 border-t border-black/10 pt-3 dark:border-white/15">
          <button
            type="button"
            onClick={handleReset}
            className="text-xs text-black/55 underline underline-offset-2 dark:text-white/55"
          >
            最初からやり直す
          </button>
          <p className="mt-1 text-xs text-black/45 dark:text-white/45">
            この会話とこのタブのフォームを空にします。
          </p>
        </div>
      )}
    </section>
  );
}

function TurnView({
  turn,
  taskId,
  nonAiPathHint,
}: {
  turn: Turn;
  taskId: TaskId;
  nonAiPathHint: string;
}) {
  return (
    <div className="grid gap-2">
      <p className="rounded-md bg-black/[.04] p-3 text-sm dark:bg-white/[.06]">
        <span className="mr-2 text-xs text-black/50 dark:text-white/50">
          指示
        </span>
        {/* 自然文が任意のタブでは、指示なしで送った往復もログに残る。空欄のまま
            並べると送信そのものが無かったように見えるので、そう書く。 */}
        {turn.prompt === "" ? (
          <span className="text-black/55 dark:text-white/55">
            （指示なし。参加可否表だけで提案）
          </span>
        ) : (
          turn.prompt
        )}
      </p>
      {turn.ok ? (
        <div className="rounded-md border border-black/10 p-3 text-sm dark:border-white/15">
          <p>{turn.message}</p>
          <ReportView report={turn.report} />
        </div>
      ) : (
        <ErrorView
          guidance={turn.guidance}
          taskId={taskId}
          nonAiPathHint={nonAiPathHint}
        />
      )}
    </div>
  );
}

/**
 * 失敗の表示（参照ドキュメント 9.3節）。
 *
 * 起きたことと次の一手を分けて出す。統制のコントローラビリティは「AI が失敗した
 * ことが分かる」だけでは足りず、**その場から非AI経路へ抜けられる**ところまでで
 * 成り立つ（PO ストーリー41）。
 *
 * 導線をリンクで出すのは、「左のフォーム」と書いて済ませられないため。1カラムに
 * 畳まれる幅ではフォームは左ではなく上にあり、AI が使えないと分かった直後の職員に
 * **どこへ行けば手で埋められるのか**を探させることになる。
 */
function ErrorView({
  guidance,
  taskId,
  nonAiPathHint,
}: {
  guidance: ErrorGuidance;
  taskId: TaskId;
  nonAiPathHint: string;
}) {
  return (
    <div
      role="alert"
      className="rounded-md border border-red-500/40 p-3 text-sm"
    >
      <p className="font-medium text-red-700 dark:text-red-400">
        {guidance.summary}
      </p>
      {guidance.alreadyAttempted && (
        <p className="mt-1 text-xs text-black/55 dark:text-white/55">
          {guidance.alreadyAttempted}
        </p>
      )}
      <p className="mt-2 text-black/70 dark:text-white/70">
        {guidance.nextStep}
        {guidance.offersNonAiPath && nonAiPathHint}
      </p>
      {guidance.offersNonAiPath && (
        <a
          href={`#${formSectionId(taskId)}`}
          className="mt-3 inline-block rounded-md border border-black/15 px-3 py-1.5 text-xs font-medium dark:border-white/20"
        >
          AI を使わずに入力する
        </a>
      )}
    </div>
  );
}

/**
 * 追加の指示で何が変わったかの表示（ストーリー9）。
 *
 * `message` の隣に別立てで出す。`message` はモデルが書いた文なので、そこに書かれた
 * 項目が実際にフォームへ入ったとは限らない（手入力で守られた欄、候補日程に無い日付）。
 * こちらは画面が実際にやったことだけを言う。
 */
function ReportView({ report }: { report: ApplyReport }) {
  if (report.updated.length === 0 && report.preserved.length === 0) {
    return (
      <p className="mt-2 text-xs text-black/55 dark:text-white/55">
        フォームは変わっていません。
      </p>
    );
  }
  return (
    <dl className="mt-2 grid gap-1 text-xs">
      {report.updated.length > 0 && (
        <div className="flex gap-2">
          <dt className="shrink-0 text-black/55 dark:text-white/55">更新</dt>
          <dd>{report.updated.join(" / ")}</dd>
        </div>
      )}
      {report.preserved.length > 0 && (
        <div className="flex gap-2">
          <dt className="shrink-0 text-black/55 dark:text-white/55">
            手入力のため保持
          </dt>
          <dd>{report.preserved.join(" / ")}</dd>
        </div>
      )}
    </dl>
  );
}
