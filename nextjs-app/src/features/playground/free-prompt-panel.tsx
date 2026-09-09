"use client";

import { useId, useRef, useState } from "react";
import {
  AiErrorNotice,
  AiPendingNotice,
} from "@/components/ai-assistant/ai-notice";
import { TabHeading } from "@/components/screen-layout";
import { FREE_PROMPT_TASK_ID, requestAiTask } from "@/lib/api";
import { MAX_PROMPT_LENGTH } from "@/lib/contracts/limits";
import { isPromptRequired } from "@/lib/contracts/prompt-requirement";
import { type ErrorGuidance, errorGuidanceFor } from "@/lib/error-guidance";

/**
 * プロンプト検証タブ（ADR-0020、#198）。
 *
 * **この画面にフォームは無い。** AI入力アシスタント（指示 → プレビュー → 反映）も
 * 使わない — 反映する先が無く、出力契約が `message` を持たないため。したがって
 * 非AI経路も無く、失敗しても「手動で入力してください」とは言えない。
 *
 * 職員が書くのは**持ち込みシステムプロンプト**（そのまま system prompt になる）と
 * **検証メッセージ**（user message になる）の2つで、返るのは**回答本文**だけである。
 */

export function FreePromptPanel() {
  const systemPromptId = useId();
  const messageId = useId();

  const [systemPrompt, setSystemPrompt] = useState("");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const [failure, setFailure] = useState<ErrorGuidance | null>(null);
  /**
   * 会話の継続（ADR-0020）。**持ち込みシステムプロンプトが変わったかを見るのは
   * Runtime 側**で、画面は同じセッションを渡し続けるだけでよい。変わっていれば
   * 向こうがセッションを捨てて作り直すので、ここで捨てると追い質問が毎回初回になる。
   */
  const [sessionId, setSessionId] = useState<string | null>(null);

  /**
   * 送信ごとの連番。中断や二重送信で飛んだ結果を後から拾わないために持つ
   * （`recommend-panel.tsx` と同じ理由）。
   */
  const submitSerial = useRef(0);

  const promptRequired = isPromptRequired(FREE_PROMPT_TASK_ID);
  /*
    どちらかが空なら送れない（ADR-0022）。検証メッセージの可否は契約の表から引く
    — 画面に「必須」と書き写すと、表が変わったときにここだけ古い判断で残る。
    持ち込みシステムプロンプトのほうは必須が入力契約に埋まっている（空文字も
    空白だけも `freePromptInputSchema` が弾く）ので、ここは同じ判断を先に出すだけ。
  */
  const submittable =
    systemPrompt.trim() !== "" && (!promptRequired || message.trim() !== "");

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    // 送信中は押せないが、Enter や連打で二重に入る経路をここでも塞ぐ。
    if (pending || !submittable) return;

    const serial = ++submitSerial.current;
    setPending(true);
    setFailure(null);
    // 前の回答本文は残さない。新しい送信の下に古い答えが並ぶと、どちらが今の
    // プロンプトの効きなのか読めない。
    setAnswer(null);

    const outcome = await requestAiTask({
      taskId: FREE_PROMPT_TASK_ID,
      prompt: message,
      sessionId,
      input: { system_prompt: systemPrompt },
    });
    if (serial !== submitSerial.current) return;

    if (outcome.ok) {
      setAnswer(outcome.result.text);
      setSessionId(outcome.sessionId);
    } else {
      // 書いた2欄はどちらも消さない。書き直して送り直すのがこの画面の使い方である。
      setFailure(errorGuidanceFor(outcome.code, { hasNonAiPath: false }));
    }
    setPending(false);
  }

  return (
    <section role="region" aria-label="プロンプト検証">
      <TabHeading>プロンプト検証</TabHeading>
      <p className="mb-6 text-dns-14N-130 text-solid-gray-700">
        持ち込みシステムプロンプトがそのまま system prompt に、検証メッセージが
        user message になります。我々が足すのは基準時刻の付記だけで、Skill も
        出力形式の指示も足しません。
      </p>

      <form onSubmit={handleSubmit}>
        <label
          htmlFor={systemPromptId}
          className="block text-dns-14M-130 text-solid-gray-900"
        >
          持ち込みシステムプロンプト
        </label>
        <textarea
          id={systemPromptId}
          value={systemPrompt}
          onChange={(event) => setSystemPrompt(event.target.value)}
          rows={10}
          maxLength={MAX_PROMPT_LENGTH}
          placeholder="あなたは自治体職員の業務を支援するアシスタントです。..."
          className="mt-2 w-full rounded-md border border-solid-gray-600 bg-white p-3 text-dns-16N-130 text-solid-gray-900 focus:outline-none focus:ring-2 focus:ring-solid-blue-700"
        />

        <label
          htmlFor={messageId}
          className="mt-4 block text-dns-14M-130 text-solid-gray-900"
        >
          検証メッセージ
        </label>
        <textarea
          id={messageId}
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          rows={4}
          maxLength={MAX_PROMPT_LENGTH}
          placeholder="出張の準備で気を付けることを教えてください"
          className="mt-2 w-full rounded-md border border-solid-gray-600 bg-white p-3 text-dns-16N-130 text-solid-gray-900 focus:outline-none focus:ring-2 focus:ring-solid-blue-700"
        />

        {!submittable && (
          <p className="mt-2 text-dns-12N-130 text-solid-gray-600">
            2欄とも書くと送信できます。
          </p>
        )}
        <div className="mt-3 flex justify-end">
          <button
            type="submit"
            disabled={pending || !submittable}
            className="rounded-md bg-solid-blue-700 px-4 py-2 text-dns-16M-130 text-white disabled:opacity-40"
          >
            {pending ? "送信中..." : "送信"}
          </button>
        </div>
      </form>

      {pending && <AiPendingNotice message="AI が応答しています..." />}

      {failure !== null && (
        <div className="mt-4">
          <AiErrorNotice guidance={failure} taskId={FREE_PROMPT_TASK_ID} />
        </div>
      )}

      {answer !== null && (
        <div className="mt-6">
          <h3 className="text-dns-14M-130 text-solid-gray-900">回答本文</h3>
          {/*
            改行を保ったまま、**HTML としては解釈せずに**描く。React が escape する
            ので `{answer}` と書くこと自体がその保証になる（`dangerouslySetInnerHTML`
            を使わない）。BFF がこの taskId でタグ除去を掛けないことの前提条件である
            （ADR-0020）。
          */}
          <p className="mt-2 whitespace-pre-wrap rounded-md border border-solid-gray-300 bg-white p-4 text-dns-16N-130 text-solid-gray-900">
            {answer}
          </p>
        </div>
      )}
    </section>
  );
}
