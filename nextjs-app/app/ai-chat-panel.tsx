"use client";

import type { TaskId } from "@contracts/index.js";
import { useId, useState } from "react";
import { errorMessageFor } from "./lib/error-messages";
import { requestAiTask, type TaskOutputs } from "./lib/api";

type AiChatPanelProps<TTaskId extends TaskId> = {
  taskId: TTaskId;
  description: string;
  placeholder: string;
  onResult: (result: TaskOutputs[TTaskId]) => void;
};

/**
 * 全タブで共有する AI チャット欄。
 *
 * WHY: タブごとに違うのは `taskId` と文言だけで、経路も表示も同じにする。
 * 「同じチャット欄が taskId を切り替えて違う結果を返す」という参照アーキテクチャの
 * 構造を、画面の実物として見えるようにするため。
 */
export function AiChatPanel<TTaskId extends TaskId>({
  taskId,
  description,
  placeholder,
  onResult,
}: AiChatPanelProps<TTaskId>) {
  const [prompt, setPrompt] = useState("");
  const [pending, setPending] = useState(false);
  const [aiMessage, setAiMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const promptId = useId();

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (prompt.trim() === "" || pending) return;
    setPending(true);
    setErrorMessage(null);
    setAiMessage(null);
    const outcome = await requestAiTask(taskId, prompt);
    setPending(false);
    if (outcome.ok) {
      onResult(outcome.result);
      setAiMessage(outcome.result.message);
    } else {
      setErrorMessage(errorMessageFor(outcome.code));
    }
  }

  return (
    <section className="rounded-lg border border-black/10 p-6 dark:border-white/15">
      <h2 className="text-lg font-semibold">AI チャット</h2>
      <p className="mt-1 text-sm text-black/60 dark:text-white/60">
        {description}
      </p>

      <form onSubmit={handleSubmit} className="mt-4">
        <label htmlFor={promptId} className="sr-only">
          AI への指示
        </label>
        <textarea
          id={promptId}
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          rows={5}
          placeholder={placeholder}
          className="w-full rounded-md border border-black/15 bg-transparent p-3 text-sm dark:border-white/20"
        />
        <button
          type="submit"
          disabled={pending || prompt.trim() === ""}
          className="mt-3 w-full rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-40"
        >
          {pending ? "生成中…" : "フォームを埋める"}
        </button>
      </form>

      {aiMessage !== null && (
        <p className="mt-4 rounded-md bg-black/[.04] p-3 text-sm dark:bg-white/[.06]">
          {aiMessage}
        </p>
      )}
      {errorMessage !== null && (
        <p
          role="alert"
          className="mt-4 rounded-md border border-red-500/40 p-3 text-sm text-red-700 dark:text-red-400"
        >
          {errorMessage}
        </p>
      )}
    </section>
  );
}
