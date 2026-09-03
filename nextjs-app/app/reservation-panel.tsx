"use client";

import type { ParseReservationOutput } from "@contracts/index.js";
import { useId, useState } from "react";
import { parseReservation } from "./lib/api";
import { errorMessageFor } from "./lib/error-messages";

type FieldName =
  | "departure_date"
  | "return_date"
  | "origin"
  | "destination"
  | "transport";

/**
 * 値の出どころ。AI由来であることを画面に出すために持つ（統制「透明性」）。
 * 職員が手を入れた時点で manual に戻り、バッジが消える。
 */
type FieldSource = "manual" | "ai";

type FormState = Record<FieldName, { value: string; source: FieldSource }>;

const EMPTY_FORM: FormState = {
  departure_date: { value: "", source: "manual" },
  return_date: { value: "", source: "manual" },
  origin: { value: "", source: "manual" },
  destination: { value: "", source: "manual" },
  transport: { value: "", source: "manual" },
};

const TRANSPORT_LABELS = {
  train: "鉄道",
  flight: "航空機",
  other: "その他",
} as const;

export function ReservationPanel() {
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [prompt, setPrompt] = useState("");
  const [pending, setPending] = useState(false);
  const [aiMessage, setAiMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const promptId = useId();

  function setField(name: FieldName, value: string) {
    setForm((current) => ({ ...current, [name]: { value, source: "manual" } }));
  }

  function applyResult(result: ParseReservationOutput) {
    setForm((current) => {
      const next = { ...current };
      // 読み取れなかった項目（null）は触らない。職員が先に手で埋めていた値を
      // AI が空に戻してしまうのを避ける。
      for (const name of Object.keys(EMPTY_FORM) as FieldName[]) {
        const raw = result[name];
        if (raw === null) continue;
        // 日付は出力契約が YYYY-MM-DD を保証するので、`<input type="date">` へ
        // そのまま渡せる。整形は要らない。
        next[name] = { value: raw, source: "ai" };
      }
      return next;
    });
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (prompt.trim() === "" || pending) return;
    setPending(true);
    setErrorMessage(null);
    setAiMessage(null);
    const outcome = await parseReservation(prompt);
    setPending(false);
    if (outcome.ok) {
      applyResult(outcome.result);
      setAiMessage(outcome.result.message);
    } else {
      setErrorMessage(errorMessageFor(outcome.code));
    }
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_20rem]">
      <section className="rounded-lg border border-black/10 p-6 dark:border-white/15">
        <h2 className="text-lg font-semibold">交通IC予約</h2>
        <p className="mt-1 text-sm text-black/60 dark:text-white/60">
          AI を使わずに、最初からこのフォームだけで入力できます。
        </p>

        <div className="mt-6 grid gap-5 sm:grid-cols-2">
          <Field
            name="departure_date"
            label="出発日"
            type="date"
            state={form.departure_date}
            onChange={setField}
          />
          <Field
            name="return_date"
            label="帰着日"
            type="date"
            state={form.return_date}
            onChange={setField}
          />
          <Field
            name="origin"
            label="出発地"
            type="text"
            state={form.origin}
            onChange={setField}
          />
          <Field
            name="destination"
            label="目的地"
            type="text"
            state={form.destination}
            onChange={setField}
          />
          <TransportField state={form.transport} onChange={setField} />
        </div>
      </section>

      <section className="rounded-lg border border-black/10 p-6 dark:border-white/15">
        <h2 className="text-lg font-semibold">AI チャット</h2>
        <p className="mt-1 text-sm text-black/60 dark:text-white/60">
          出張の予定を文章で書くと、左のフォームを埋めます。
        </p>

        <form onSubmit={handleSubmit} className="mt-4">
          <label htmlFor={promptId} className="sr-only">
            出張の予定
          </label>
          <textarea
            id={promptId}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            rows={5}
            placeholder="来月15日から3泊4日で大阪出張、新幹線で往復"
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
    </div>
  );
}

function AiBadge() {
  return (
    <span className="rounded-full bg-blue-600/10 px-2 py-0.5 text-[11px] font-medium text-blue-700 dark:bg-blue-400/15 dark:text-blue-300">
      AI が入力
    </span>
  );
}

function ClearButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-xs text-black/50 underline underline-offset-2 dark:text-white/50"
    >
      消す
    </button>
  );
}

type FieldProps = {
  name: FieldName;
  label: string;
  type: "date" | "text";
  state: { value: string; source: FieldSource };
  onChange: (name: FieldName, value: string) => void;
};

function Field({ name, label, type, state, onChange }: FieldProps) {
  const id = useId();
  return (
    <div>
      <div className="flex items-center gap-2">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        {state.source === "ai" && <AiBadge />}
        {state.value !== "" && (
          <ClearButton onClick={() => onChange(name, "")} />
        )}
      </div>
      <input
        id={id}
        type={type}
        value={state.value}
        onChange={(event) => onChange(name, event.target.value)}
        className="mt-1.5 w-full rounded-md border border-black/15 bg-transparent px-3 py-2 text-sm dark:border-white/20"
      />
    </div>
  );
}

function TransportField({
  state,
  onChange,
}: {
  state: { value: string; source: FieldSource };
  onChange: (name: FieldName, value: string) => void;
}) {
  const id = useId();
  return (
    <div>
      <div className="flex items-center gap-2">
        <label htmlFor={id} className="text-sm font-medium">
          交通手段
        </label>
        {state.source === "ai" && <AiBadge />}
        {state.value !== "" && (
          <ClearButton onClick={() => onChange("transport", "")} />
        )}
      </div>
      <select
        id={id}
        value={state.value}
        onChange={(event) => onChange("transport", event.target.value)}
        className="mt-1.5 w-full rounded-md border border-black/15 bg-transparent px-3 py-2 text-sm dark:border-white/20"
      >
        <option value="">未選択</option>
        {Object.entries(TRANSPORT_LABELS).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
    </div>
  );
}
