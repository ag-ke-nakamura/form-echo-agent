"use client";

import type { ParseReservationOutput } from "@contracts/index.js";
import { useId, useState } from "react";
import { AiChatPanel } from "./ai-chat-panel";
import { AiBadge, type ApplyReport, type FieldSource } from "./field-source";
import { FormSection } from "./form-section";
import { RESERVATION_TASK_ID } from "./lib/api";

type FieldName =
  | "departure_date"
  | "return_date"
  | "origin"
  | "destination"
  | "transport";

/**
 * 交通ICのフォームの状態モデル。スカラーの平坦なマップ。
 * 候補日程タブとは形が違うので共有しない（共有するのは `FieldSource` だけ）。
 */
type FormState = Record<FieldName, { value: string; source: FieldSource }>;

const EMPTY_FORM: FormState = {
  departure_date: { value: "", source: "manual" },
  return_date: { value: "", source: "manual" },
  origin: { value: "", source: "manual" },
  destination: { value: "", source: "manual" },
  transport: { value: "", source: "manual" },
};

/**
 * 欄の表示名。JSX と再生成の報告の両方から引く。
 *
 * 報告（`ApplyReport`）に載せる文字列がここから来るので、片方だけ直すと画面の
 * ラベルと「更新: 出発日」の言い方が食い違う。
 */
const FIELD_LABELS: Record<FieldName, string> = {
  departure_date: "出発日",
  return_date: "帰着日",
  origin: "出発地",
  destination: "目的地",
  transport: "交通手段",
};

const FIELD_NAMES = Object.keys(FIELD_LABELS) as FieldName[];

const TRANSPORT_LABELS = {
  train: "鉄道",
  flight: "航空機",
  other: "その他",
} as const;

/**
 * AI の出力をフォームへ写し、何を更新して何を守ったかを一緒に返す。
 *
 * **手で直した欄は上書きしない**（#38 の判断）。これで AI バッジが「再生成で
 * 上書きされる範囲」の印としても働く。代わりに、追加で指示したのに変わらない欄が
 * 出るので、守ったことを報告に載せて画面から分かるようにする。
 *
 * 既知の穴: 職員が「消す」で空にした AI 由来の欄は `{value: "", source: "manual"}`
 * になるが、空欄は初期状態と区別が付かないので次の再生成で埋め直される。分けるには
 * `FieldSource` に3つ目の状態が必要で、それを足すと3タブすべての印の意味が変わる。
 * 埋め直しは報告の「更新」に出るので、第1段はこのまま進める。
 */
function applyToForm(
  current: FormState,
  result: ParseReservationOutput,
): { next: FormState; report: ApplyReport } {
  const next = { ...current };
  const updated: string[] = [];
  const preserved: string[] = [];

  for (const name of FIELD_NAMES) {
    const raw = result[name];
    // 読み取れなかった項目（null）は触らない。職員が先に手で埋めていた値を
    // AI が空に戻してしまうのを避ける。
    if (raw === null) continue;
    const field = current[name];
    if (field.source === "manual" && field.value !== "") {
      preserved.push(FIELD_LABELS[name]);
      continue;
    }
    // 同じ値なら「更新」に数えない。読み取り直した項目を毎回並べると、実際に
    // 変わった項目が埋もれる（追加の指示は普通1〜2項目しか動かさない）。
    if (field.value === raw) continue;
    // 日付は出力契約が YYYY-MM-DD を保証するので、`<input type="date">` へ
    // そのまま渡せる。整形は要らない。
    next[name] = { value: raw, source: "ai" };
    updated.push(FIELD_LABELS[name]);
  }

  return { next, report: { updated, preserved } };
}

export function ReservationPanel() {
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  function setField(name: FieldName, value: string) {
    setForm((current) => ({ ...current, [name]: { value, source: "manual" } }));
  }

  /**
   * WHY: 判断を `applyToForm` に出して setState の updater に置かないのは、何を
   * 更新して何を守ったかを**同期で**返す必要があるため（updater は純粋に保つ
   * 約束があり、実行も後になる）。
   */
  function applyResult(result: ParseReservationOutput): ApplyReport {
    const { next, report } = applyToForm(form, result);
    setForm(next);
    return report;
  }

  function resetForm() {
    setForm(EMPTY_FORM);
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_20rem]">
      <FormSection taskId={RESERVATION_TASK_ID}>
        <h2 className="text-lg font-semibold">交通IC予約</h2>
        <p className="mt-1 text-sm text-black/60 dark:text-white/60">
          AI を使わずに、最初からこのフォームだけで入力できます。
        </p>

        <div className="mt-6 grid gap-5 sm:grid-cols-2">
          <Field
            name="departure_date"
            type="date"
            state={form.departure_date}
            onChange={setField}
          />
          <Field
            name="return_date"
            type="date"
            state={form.return_date}
            onChange={setField}
          />
          <Field
            name="origin"
            type="text"
            state={form.origin}
            onChange={setField}
          />
          <Field
            name="destination"
            type="text"
            state={form.destination}
            onChange={setField}
          />
          <TransportField state={form.transport} onChange={setField} />
        </div>
      </FormSection>

      <AiChatPanel
        taskId={RESERVATION_TASK_ID}
        nonAiPathHint="AI を使わなくても、すべての項目を手で埋められます。"
        description="出張の予定を文章で書くと、左のフォームを埋めます。書き足りなかったことは、続けて指示できます。"
        placeholder="来月15日から3泊4日で大阪出張、新幹線で往復"
        followUpPlaceholder="往路は10月16日でした"
        onResult={applyResult}
        onReset={resetForm}
      />
    </div>
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
  type: "date" | "text";
  state: { value: string; source: FieldSource };
  onChange: (name: FieldName, value: string) => void;
};

function Field({ name, type, state, onChange }: FieldProps) {
  const id = useId();
  return (
    <div>
      <div className="flex items-center gap-2">
        <label htmlFor={id} className="text-sm font-medium">
          {FIELD_LABELS[name]}
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
          {FIELD_LABELS.transport}
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
