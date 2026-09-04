"use client";

import type { ParseReservationOutput } from "@contracts/index.js";
import { useId, useState } from "react";
import { AiAssistant } from "./ai-assistant";
import { AiBadge, type ApplyReport, type FieldSource } from "./field-source";
import { FormSection } from "./form-section";
import { RESERVATION_TASK_ID } from "./lib/api";
import {
  applyToForm,
  EMPTY_FORM,
  FIELD_LABELS,
  type FieldName,
  type FormState,
  reservationPreviewItems,
  TRANSPORT_LABELS,
} from "./lib/reservation-form";
import { ManualInputDivider, TabHeading } from "./screen-layout";

export function ReservationPanel() {
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  function setField(name: FieldName, value: string) {
    setForm((current) => ({ ...current, [name]: { value, source: "manual" } }));
  }

  /**
   * WHY: 判断を `applyToForm`（`lib/reservation-form.ts`）に出して setState の updater
   * に置かないのは、何を更新して何を守ったかを**同期で**返す必要があるため（updater は
   * 純粋に保つ約束があり、実行も後になる）。
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
    <div className="mx-auto max-w-3xl">
      <TabHeading>交通ICカード予約申請</TabHeading>

      <AiAssistant
        taskId={RESERVATION_TASK_ID}
        /*
          このタブだけは構造化入力を持たない（ADR-0005 の表）。送るべき画面状態が
          無く、相対的な日付を解決する基準時刻は Runtime の system prompt が持つ。
          省略ではなく `undefined` を書くのは `INPUT_SCHEMAS` の `null` と同じ理由で、
          まだ足していないのか足さないと決めたのかを区別するため。
        */
        input={undefined}
        nonAiPathHint="AI を使わなくても、すべての項目を手で埋められます。"
        description={
          "自然な言葉で予約内容を入力すると、AIが自動的にフォームに入力します。\n" +
          "例: 「来月15日から3泊4日で大阪出張、新幹線で往復」"
        }
        placeholder="予約内容を自然な言葉で入力してください..."
        followUpPlaceholder="往路は10月16日でした"
        submitLabel="AIで入力内容を生成"
        pendingLabel="生成中..."
        generatingMessage="AIが内容を生成しています..."
        applyLabel="この内容でフォームに入力"
        emptyItemText="（未入力）"
        /*
          いまのフォームを渡す。手で入れた欄は反映しても変わらないので、押す前に
          そう出す必要がある（ADR-0006）。描画のたびに呼ばれるので、待っている間の
          手入力もプレビューに映る。
        */
        previewItems={(result) => reservationPreviewItems(result, form)}
        onApply={applyResult}
        onReset={resetForm}
      />

      <ManualInputDivider />

      <FormSection taskId={RESERVATION_TASK_ID}>
        <div className="grid gap-5 sm:grid-cols-2">
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
    </div>
  );
}

function ClearButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-dns-12N-130 text-solid-gray-600 underline underline-offset-2"
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
        <label htmlFor={id} className="text-dns-14M-130 text-solid-gray-900">
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
        className="mt-1.5 w-full rounded-md border border-solid-gray-600 bg-white px-3 py-2 text-dns-16N-130 text-solid-gray-900"
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
        <label htmlFor={id} className="text-dns-14M-130 text-solid-gray-900">
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
        className="mt-1.5 w-full rounded-md border border-solid-gray-600 bg-white px-3 py-2 text-dns-16N-130 text-solid-gray-900"
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
