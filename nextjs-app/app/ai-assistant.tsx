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
import {
  AiErrorNotice,
  AiPendingNotice,
  AiPreview,
  ApplyReportView,
} from "./ai-notice";
import type { ApplyReport } from "./field-source";
import { formSectionId } from "./form-section";
import { MAX_CONSECUTIVE_FAILURES, type PreviewItem } from "./lib/ai-preview";
import { requestAiTask, type TaskInputs, type TaskOutputs } from "./lib/api";
import { type ErrorGuidance, errorGuidanceFor } from "./lib/error-guidance";

/**
 * 反映を待っている結果（ADR-0006）。
 *
 * **フォームはまだ変わっていない。** 職員が反映を押すまでこれが唯一の置き場所で、
 * タブを移って戻ってきても残る（タブは描かれたまま `hidden` で隠れるだけなので、
 * 状態はここに置くだけで寿命がタブと同じになる）。
 *
 * 送った指示も一緒に持つ。書き直すときに前の指示が読めないと、何をどう変えたのかが
 * 手元に残らない（成功したときは入力欄を空にするため）。
 */
type Preview<TTaskId extends TaskId> = {
  prompt: string;
  result: TaskOutputs[TTaskId];
};

type AiAssistantProps<TTaskId extends TaskId> = {
  taskId: TTaskId;
  /**
   * このタブが Runtime へ渡す画面の状態（ADR-0005）。
   *
   * **毎回そのまま送る。** Runtime 側の会話履歴はコールドスタートで消えるので、
   * 初回だけ送ると2回目が「与件の無いリクエスト」になる。省略できないよう必須の
   * prop にしてある — 交通ICのように構造化入力を持たない taskId では型が
   * `undefined` になるので、書き忘れと「送らないと決めた」が型で区別される。
   */
  input: TaskInputs[TTaskId];
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
  /**
   * 送信できない理由。`null` なら送れる。
   *
   * WHY: 構造化入力が入力契約を満たさない画面状態がありうる（参加可否タブの候補日程が
   * 0件のとき）。押させると BFF の門で必ず INVALID_INPUT になり、職員は自分の書いた
   * 自然文が悪かったのかと読む。押す前に理由を出すほうが短い。
   *
   * 判断そのものはタブが持つ。ここで `INPUT_SCHEMAS` を値として引くと zod が SSG の
   * バンドルに乗る（`lib/api.ts` の `TaskInputs` が型だけを取り込んでいるのと同じ理由）。
   */
  submitBlockedReason?: string | null;
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
  /** 反映のボタンの文言（設計書 3.6.4節）。「この内容でフォームに入力」など。 */
  applyLabel: string;
  /** 抽出・判定できなかった行に添える文字列（設計書 3.6.1節・4.6.1節）。 */
  emptyItemText: string;
  /**
   * 結果をプレビューの一覧へ写す（ADR-0006）。
   *
   * WHY 反映（`onApply`）と別に持つか: プレビューは**フォームを触らずに**結果を読む
   * 必要がある。反映と同じ関数で作ると、押す前に見せるだけのために状態を書き換える
   * ことになる。描画のたびに呼ぶので、画面の今の状態（参加可否タブなら候補日程の
   * 一覧）を見た一覧になる。
   */
  previewItems: (result: TaskOutputs[TTaskId]) => PreviewItem[];
  /** プレビューの内容をフォームへ写し、何を更新して何を守ったかを返す。 */
  onApply: (result: TaskOutputs[TTaskId]) => ApplyReport;
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
 * 責務は「送る・プレビューを持つ・反映を親に伝える」（ADR-0006）。**応答が来ても
 * フォームは変わらない** — 職員が反映を押したときだけ `onApply` が呼ばれる。
 * 受信と同時に書き込んで事後報告する形をやめたのは、事後報告が「何が変わったか」は
 * 伝えても「変えるかどうか」を職員に選ばせないため。
 *
 * `sessionId` をタブごとにここで持つのは #38 の判断（タブは別々の会話として進む）。
 * 会話ログは持たない — プレビューが1つで、そこに送った指示と結果が並ぶ。往復のたびに
 * プレビューを積むと、**一度も反映されなかった結果に緑のチェックが並ぶ**一覧になり、
 * フォームに入っているものと見分けが付かない。セッションが続いていることは往復数で出す。
 *
 * **候補日提案タブはこれを使わない。** 設計書がそこを「AI の提案は叩き台であって
 * 対話相手ではない」と位置づけており、自然文入力欄も折りたたみも持たない。
 */
export function AiAssistant<TTaskId extends TaskId>({
  taskId,
  input,
  submitBlockedReason = null,
  description,
  nonAiPathHint,
  placeholder,
  followUpPlaceholder,
  submitLabel,
  pendingLabel,
  generatingMessage,
  applyLabel,
  emptyItemText,
  previewItems,
  onApply,
  onReset,
}: AiAssistantProps<TTaskId>) {
  const [prompt, setPrompt] = useState("");
  const [pending, setPending] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  /** これまでの往復数。セッションが続いていること自体を画面に出すために持つ（#38）。 */
  const [exchanges, setExchanges] = useState(0);
  /** 反映を待っている結果。押すまでフォームは変わらない（ADR-0006）。 */
  const [preview, setPreview] = useState<Preview<TTaskId> | null>(null);
  /** 直近の失敗。赤で出す（`AiErrorCode` が返ったときだけ）。 */
  const [failure, setFailure] = useState<ErrorGuidance | null>(null);
  /** 続けて失敗した回数が上限に達したか（設計書 3.7節）。 */
  const [exhausted, setExhausted] = useState(false);
  /** 直近の反映が実際にフォームへ何をしたか（#38）。 */
  const [applied, setApplied] = useState<ApplyReport | null>(null);
  /** 設計書 3.1節: 初期は展開。何ができる画面なのかを最初に見せる。 */
  const [expanded, setExpanded] = useState(true);

  const promptId = useId();
  const bodyId = useId();
  const promptRef = useRef<HTMLTextAreaElement>(null);

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
   * リクエストの結果が返ってくることはある（`abort` はネットワークを止めるが、
   * すでに応答本文が届いていれば `await` は成功で戻る）。番号で照合せずに
   * プレビューへ入れると、消したはずの結果が数秒後に反映待ちとして現れる。
   */
  const submitSerial = useRef(0);

  /**
   * 実行中のリクエストを打ち切る手。「最初からやり直す」が引く。
   *
   * 連番で捨てるだけでは Runtime は最後まで推論する。職員が捨てると決めた往復に
   * 時間と課金を使わないよう、実際に止める。
   */
  const inFlight = useRef<AbortController | null>(null);

  /**
   * 続けて失敗した回数。**state ではなく ref で持つ。**
   *
   * WHY: 数える場所が `await` の後になるので、state から読むとその往復が始まった
   * 時点の値になる。表示に要るのは「上限に達したか」だけ（`exhausted`）で、
   * 回数そのものは描画に出ない。
   */
  const failureStreak = useRef(0);

  /**
   * 最新の `onApply` / `onReset`。
   *
   * WHY: 応答を待っている間に職員がフォームを触ると親が再レンダーされるが、実行中の
   * `handleSubmit` のクロージャは古い prop を掴んだままになる。古い `onApply` は
   * 編集前のフォーム状態を見て上書きの可否を決めるので、**待っている間の手入力を
   * AI 由来と誤認して踏み潰す**。「手入力は上書きしない」を守るには、写す時点で
   * 最新の状態を見ている関数を呼ぶ必要がある。
   *
   * 反映がプレビューを挟むようになって待ち時間はさらに伸びた（応答の到着ではなく
   * 職員が押した時点で写す）ので、ref から引く必要はむしろ強くなった。
   *
   * `previewItems` はここに入れない。描画のたびに呼ぶので、そもそも古いものを
   * 掴む余地が無い。
   */
  const handlers = useRef({ onApply, onReset });
  useEffect(() => {
    handlers.current = { onApply, onReset };
  }, [onApply, onReset]);

  /**
   * 非AI経路のフォームへフォーカスを移す（設計書 3.7節）。
   *
   * 飛び先は `FormSection`（`tabIndex={-1}` を持つ）。リンクを踏ませずに移すのは、
   * 続けて失敗した職員には次の一手がもう1つしか無いため。
   */
  function focusNonAiPath() {
    document.getElementById(formSectionId(taskId))?.focus();
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const sent = prompt.trim();
    if (pending || submitBlockedReason !== null) return;
    if (promptRequired && sent === "") return;
    const serial = ++submitSerial.current;
    const controller = new AbortController();
    inFlight.current = controller;
    setPending(true);
    setFailure(null);

    const outcome = await requestAiTask({
      taskId,
      // 空文字ではなく null で送る。BFF から見て「書かれなかった」と
      // 「空を書いた」を区別する必要はなく、契約は任意フィールドの欠落で表す。
      prompt: sent === "" ? null : sent,
      sessionId,
      // 送信のたびに今の画面の状態を送る（`AiAssistantProps` の `input`）。
      input,
      signal: controller.signal,
    });
    // 待っている間にやり直されていたら、この結果は捨てる（`pending` は
    // `handleReset` が下ろしている）。
    if (serial !== submitSerial.current) return;
    inFlight.current = null;

    if (outcome.ok) {
      setSessionId(outcome.sessionId);
      setExchanges((current) => current + 1);
      failureStreak.current = 0;
      setExhausted(false);
      setPreview({ prompt: sent, result: outcome.result });
      /*
        前の反映の報告は消す。あれは「その時フォームへ何をしたか」なので、新しい結果が
        届いた時点で今の画面と対応しなくなる（残すと、まだ反映していない結果の隣に
        反映済みの報告が並ぶ）。
      */
      setApplied(null);
      setPrompt("");
    } else {
      /*
        失敗しても sessionId は捨てない。会話は Runtime 側に残っているので、
        書き直して送れば続きとして届く。プレビューも捨てない — 前の結果と見比べながら
        書き直せることのほうが、消して整えることより役に立つ。

        ただし上限に達すると下で縮めるので、プレビューは展開し直すまで見えなくなる。
        許容する: 良い結果なら反映しているはずで、そこから3回作り直したということは
        その結果は職員が採らなかったものである。
      */
      setFailure(errorGuidanceFor(outcome.code));
      failureStreak.current += 1;
      if (failureStreak.current >= MAX_CONSECUTIVE_FAILURES) {
        setExhausted(true);
        setExpanded(false);
        focusNonAiPath();
      }
      // 失敗したときは書いたものを残す。INVALID_INPUT のように**書き直して
      // もらう**エラーがあるので、消すと言い直しのために全部打ち直しになる。
    }

    setPending(false);
  }

  /**
   * 待つのをやめる（設計書 8節）。**会話もフォームも触らない。**
   *
   * WHY 「最初からやり直す」と分けるか: あちらは会話とフォームを空にする操作で、
   * 出ているものが1つも無い初回の送信中は出さない（空にするものが無い）。中断が
   * そこに乗っていると、**初回の推論を止める手が画面のどこにも無い**。止めた後は
   * 書き直して送り直せる状態に戻したいので、`sessionId` もプレビューも残す。
   */
  function handleCancel() {
    // 番号を進めて、飛んでいるリクエストの結果を無効にしてから止める。
    submitSerial.current++;
    inFlight.current?.abort();
    inFlight.current = null;
    setPending(false);
  }

  /**
   * プレビューの内容をフォームへ写す。**ここが唯一フォームを変える経路**（ADR-0006）。
   *
   * 写したらプレビューを畳む。残すと、反映済みの結果に反映のボタンが付いたまま並び、
   * 押すと「更新」の報告がもう一度出る（フォームは変わっていないのに）。
   */
  function handleApply() {
    if (preview === null) return;
    setApplied(handlers.current.onApply(preview.result));
    setPreview(null);
    // 設計書 3.6.4節・5.1節: 反映するとアシスタントが縮む。下のフォームを見せる。
    setExpanded(false);
    /*
      縮めると、いま押したボタンごと `hidden` の内側に入る。フォーカスは行き先を
      指定しないと `<body>` へ落ちるので、設計書 5.1節が指す先（非AI経路のフォーム）
      へ明示的に移す。反映した値を確かめる場所もそこである。
    */
    focusNonAiPath();
  }

  /**
   * 書き直しへ戻る（設計書 3.6.4節）。**プレビューは残す。**
   *
   * 前の結果を見ながら書き直せるようにするため。消してから書かせると、何が足りな
   * かったのかを思い出しながら打つことになる。
   */
  function handleRevise() {
    promptRef.current?.focus();
  }

  function handleReset() {
    // 番号を進めて、飛んでいるリクエストの結果を無効にする。実際にも止める。
    submitSerial.current++;
    inFlight.current?.abort();
    inFlight.current = null;
    setPending(false);
    setPreview(null);
    setFailure(null);
    setApplied(null);
    setSessionId(null);
    setExchanges(0);
    failureStreak.current = 0;
    setExhausted(false);
    setPrompt("");
    handlers.current.onReset();
  }

  /*
    プレビューの一覧は描画のたびに組み直す。状態として抱えると、応答が届いた時点の
    画面（フォームの値・候補日程の一覧）で固まり、待っている間の手入力が映らない。
  */
  const items = preview === null ? [] : previewItems(preview.result);

  /**
   * 読み上げだけに出す一文。**画面には出さない**（見れば分かるものを二重に置かない）。
   *
   * WHY 要るか: プレビューと反映の報告はどちらも「その場に挿入される」ので、live
   * region の器を兼ねさせると読み上げられないことがある。器は常設にして、中身が
   * 変わったことだけをここで伝える。
   */
  const liveStatus =
    preview !== null
      ? "AI の結果が届きました。プレビューを確認してください。"
      : applied !== null
        ? "プレビューの内容をフォームへ反映しました。"
        : "";

  const continuing = sessionId !== null;
  // 初回が失敗するとセッションは始まらないが、赤い枠は残る。やり直したいのはまさに
  // その場面なので、出ているものが1つでもあれば操作を出す。
  const resettable =
    continuing || preview !== null || failure !== null || applied !== null;

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
          セッションが続いていること自体を画面に出す（#38）。会話ログを持たなく
          なった（ADR-0006）ので、往復数だけが「前の指示が Runtime に残っている」
          ことの手がかりになる。
        */}
        {continuing && (
          <p className="mt-1 text-dns-12N-130 text-solid-gray-600">
            会話を継続中（{exchanges}往復）
          </p>
        )}

        <form onSubmit={handleSubmit} className="mt-4">
          <label htmlFor={promptId} className="sr-only">
            {continuing ? "AI への追加の指示" : "AI への指示"}
          </label>
          <textarea
            id={promptId}
            ref={promptRef}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            rows={4}
            /* 設計書 3.4節。BFF も同じ上限で弾くが、打ち切ってから弾かれるより短い。 */
            maxLength={10000}
            placeholder={continuing ? followUpPlaceholder : placeholder}
            className="w-full rounded-md border border-solid-gray-600 bg-white p-3 text-dns-16N-130 text-solid-gray-900 focus:outline-none focus:ring-2 focus:ring-solid-blue-700"
          />
          {submitBlockedReason !== null && (
            <p className="mt-2 text-dns-12N-130 text-solid-gray-600">
              {submitBlockedReason}
            </p>
          )}
          <div className="mt-3 flex justify-end">
            <button
              type="submit"
              disabled={
                pending ||
                submitBlockedReason !== null ||
                (promptRequired && prompt.trim() === "")
              }
              className="rounded-md bg-solid-blue-700 px-4 py-2 text-dns-16M-130 text-white disabled:opacity-40"
            >
              {pending ? pendingLabel : submitLabel}
            </button>
          </div>
        </form>

        {/*
          プレビューは送信ボタンの下、非AI経路のフォームの上に置く。Tab の順路が
          「テキストエリア → 生成ボタン → プレビュー内のボタン → フォーム」に
          なるのは、この並びが DOM の並びと一致しているから（設計書 7.1節）。
        */}
        {preview !== null && (
          <>
            {/* 送った指示。成功すると入力欄は空になるので、ここが唯一の控え。 */}
            <p className="mt-4 rounded-md bg-solid-gray-100 p-3 text-dns-14N-130 text-solid-gray-900">
              <span className="mr-2 text-dns-12N-130 text-solid-gray-600">
                指示
              </span>
              {/* 自然文が任意のタブでは、指示なしで送った往復もある。空欄のまま
                  置くと送信そのものが無かったように見えるので、そう書く。 */}
              {preview.prompt === "" ? (
                <span className="text-solid-gray-600">（指示なし）</span>
              ) : (
                preview.prompt
              )}
            </p>
            <AiPreview
              items={items}
              message={preview.result.message}
              emptyItemText={emptyItemText}
              applyLabel={applyLabel}
              onApply={handleApply}
              onRevise={handleRevise}
            />
          </>
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

      {/*
        生成中・失敗・反映の報告は**折りたたみの内側に置かない。** 3つとも縮んだ状態で
        起きうる（反映は自分で縮め、3回続けて失敗すると縮む）ので、内側に置くと結果が
        出た瞬間に隠れる。生成中の live region については、職員が待っている最中に
        自分で畳んだ場合も同じ。
      */}
      {pending && (
        <AiPendingNotice message={generatingMessage} onCancel={handleCancel} />
      )}
      {failure !== null && (
        <div className="mt-4">
          <AiErrorNotice
            guidance={failure}
            taskId={taskId}
            nonAiPathHint={nonAiPathHint}
            exhausted={exhausted}
          />
        </div>
      )}
      {applied !== null && (
        <div className="mt-4">
          <ApplyReportView report={applied} />
        </div>
      )}

      {/*
        読み上げ用の live region。**常に DOM に置く。** 中身入りで挿入された live
        region を読み上げない支援技術があるので、器を先に置いて中身だけを差し替える。
        画面には出さない — プレビューも報告も目で見れば分かるところに既にあり、
        ここが要るのは「応答が届いた」「反映した」という**変化の瞬間**だけである。
        生成中は `AiPendingNotice` が自前の live region で言うので重ねない。
      */}
      <p role="status" aria-live="polite" className="sr-only">
        {pending ? "" : liveStatus}
      </p>
    </section>
  );
}
