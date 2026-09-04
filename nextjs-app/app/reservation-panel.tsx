"use client";

import type { ParseReservationOutput } from "@contracts/index.js";
import { useId, useState } from "react";
import { AiAssistant } from "./ai-assistant";
import { AiBadge, type ApplyReport, type FieldSource } from "./field-source";
import { FormSection } from "./form-section";
import { RESERVATION_TASK_ID } from "./lib/api";
import { ManualInputDivider, TabHeading } from "./screen-layout";

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
    <div className="mx-auto max-w-3xl">
      <TabHeading>交通ICカード予約申請</TabHeading>

      <AiAssistant
        taskId={RESERVATION_TASK_ID}
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
        onResult={applyResult}
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
