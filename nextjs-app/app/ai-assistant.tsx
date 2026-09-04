"use client";

import type { TaskId } from "@contracts/index.js";
/*
  値として引くのはこの1モジュールだけ。`index.js` から引くと zod がバンドルに乗る
  （他の import はすべて `import type` なので実行時には消える）。拡張子を付けないのは、
  型としてしか使わない import と違ってバンドラが実際に解決するため — `.js` を付けると
  `.ts` の実体を見つけられない。
*/
import { isPromptRequired } from "@contracts/prompt-requirement";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { AiErrorNotice, AiPendingNotice, ApplyReportView } from "./ai-notice";
import type { ApplyReport } from "./field-source";
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

type AiAssistantProps<TTaskId extends TaskId> = {
  taskId: TTaskId;
  /**
   * 説明テキストと例文（設計書 3.3節）。改行を含むので `whitespace-pre-line` で描く。
   * どう書けば AI が理解するのかの見当をここで付けてもらう。
   */
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
  /** 追加の指示の例。初回とは書くことが違うので別に持つ。 */
  followUpPlaceholder: string;
  /** 送信ボタンの文言（設計書 3.4節）。「AIで候補日程を生成」など動詞がタブごとに違う。 */
  submitLabel: string;
  /** 送信中のボタンの文言（設計書 3.4節）。「生成中...」「判定中...」。 */
  pendingLabel: string;
  /** 送信中の読み上げ文（設計書 3.5節）。「AIが候補日程を生成しています...」など。 */
  generatingMessage: string;
  /** 結果をフォームへ写し、何を更新して何を守ったかを返す。 */
  onResult: (result: TaskOutputs[TTaskId]) => ApplyReport;
  /** このタブのフォームを初期状態へ戻す。 */
  onReset: () => void;
};

/**
 * 抽出系3タブが共有する AI入力アシスタント（設計書 3節）。
 *
 * WHY: タブごとに違うのは `taskId` と文言だけで、経路も表示も同じにする。
 * 「同じアシスタントが taskId を切り替えて違う結果を返す」という参照アーキテクチャの
 * 構造を、画面の実物として見えるようにするため。
 *
 * 会話ログの形にしたのは #38 の判断。単一のテキストエリアに出し直す形だと、
 * セッションが続いていること自体が画面から見えない（送った指示も前の応答も残らない）。
 * `sessionId` をタブごとにここで持つ理由も同じで、タブは別々の会話として進む。
 *
 * **候補日提案タブはこれを使わない。** 設計書がそこを「AI の提案は叩き台であって
 * 対話相手ではない」と位置づけており、自然文入力欄も折りたたみも持たない。
 */
export function AiAssistant<TTaskId extends TaskId>({
  taskId,
  description,
  nonAiPathHint,
  placeholder,
  followUpPlaceholder,
  submitLabel,
  pendingLabel,
  generatingMessage,
  onResult,
  onReset,
}: AiAssistantProps<TTaskId>) {
  const [prompt, setPrompt] = useState("");
  const [pending, setPending] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  /** 設計書 3.1節: 初期は展開。何ができる画面なのかを最初に見せる。 */
  const [expanded, setExpanded] = useState(true);

  const promptId = useId();
  const bodyId = useId();
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
    <section
      /*
        `<section>` は暗黙に region になるが、`role` を書き下す（設計書 7.2節）。
        暗黙のロールは aria-label の有無で付いたり消えたりするので、支援技術への
        約束を明示的な属性として置いておく。
      */
      role="region"
      aria-label="AI入力アシスタント"
      className="mb-6 rounded-lg border border-solid-gray-300 bg-solid-gray-50 p-6"
    >
      <button
        type="button"
        onClick={() => setExpanded((current) => !current)}
        aria-expanded={expanded}
        aria-controls={bodyId}
        className="flex items-center gap-2 text-std-20M-150 text-solid-gray-900"
      >
        {expanded ? (
          <ChevronDown aria-hidden="true" className="size-5 shrink-0" />
        ) : (
          <ChevronRight aria-hidden="true" className="size-5 shrink-0" />
        )}
        {expanded
          ? "AI入力アシスタント"
          : "AI入力アシスタント（クリックで展開）"}
      </button>

      <div id={bodyId} hidden={!expanded}>
        <p className="mt-4 whitespace-pre-line text-dns-14N-130 text-solid-gray-700">
          {description}
        </p>
        {/*
          セッションが続いていること自体を画面に出す（#38）。会話ログだけだと、
          前の往復が Runtime に残っているのか毎回初回として送っているのかが読めない。
        */}
        {continuing && (
          <p className="mt-1 text-dns-12N-130 text-solid-gray-600">
            会話を継続中（{turns.length}往復）
          </p>
        )}

        <form onSubmit={handleSubmit} className="mt-4">
          <label htmlFor={promptId} className="sr-only">
            {continuing ? "AI への追加の指示" : "AI への指示"}
          </label>
          <textarea
            id={promptId}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            rows={4}
            /* 設計書 3.4節。BFF も同じ上限で弾くが、打ち切ってから弾かれるより短い。 */
            maxLength={10000}
            placeholder={continuing ? followUpPlaceholder : placeholder}
            className="w-full rounded-md border border-solid-gray-600 bg-white p-3 text-dns-16N-130 text-solid-gray-900 focus:outline-none focus:ring-2 focus:ring-solid-blue-700"
          />
          <div className="mt-3 flex justify-end">
            <button
              type="submit"
              disabled={pending || (promptRequired && prompt.trim() === "")}
              className="rounded-md bg-solid-blue-700 px-4 py-2 text-dns-16M-130 text-white disabled:opacity-40"
            >
              {pending ? pendingLabel : submitLabel}
            </button>
          </div>
        </form>

        {turns.length > 0 && (
          <ol className="mt-4 grid gap-4">
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

        {resettable && (
          <div className="mt-4 border-t border-solid-gray-300 pt-3">
            <button
              type="button"
              onClick={handleReset}
              className="text-dns-12N-130 text-solid-gray-600 underline underline-offset-2"
            >
              最初からやり直す
            </button>
            <p className="mt-1 text-dns-12N-130 text-solid-gray-600">
              この会話とこのタブのフォームを空にします。
            </p>
          </div>
        )}
      </div>

      {pending && <AiPendingNotice message={generatingMessage} />}
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
      <p className="rounded-md bg-solid-gray-100 p-3 text-dns-14N-130 text-solid-gray-900">
        <span className="mr-2 text-dns-12N-130 text-solid-gray-600">指示</span>
        {/* 自然文が任意のタブでは、指示なしで送った往復もログに残る。空欄のまま
            並べると送信そのものが無かったように見えるので、そう書く。 */}
        {turn.prompt === "" ? (
          <span className="text-solid-gray-600">（指示なし）</span>
        ) : (
          turn.prompt
        )}
      </p>
      {turn.ok ? (
        <div className="rounded-lg border border-solid-blue-500 bg-white p-4">
          {/* 設計書 3.6.2節。AI が書いた文であることが分かるよう青で囲う。 */}
          <p className="border-l-4 border-solid-blue-700 bg-solid-blue-50 p-3 text-dns-14N-130 text-solid-gray-900">
            {turn.message}
          </p>
          <ApplyReportView report={turn.report} />
        </div>
      ) : (
        <AiErrorNotice
          guidance={turn.guidance}
          taskId={taskId}
          nonAiPathHint={nonAiPathHint}
        />
      )}
    </div>
  );
}
