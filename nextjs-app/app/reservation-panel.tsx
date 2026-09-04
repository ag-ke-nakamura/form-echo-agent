"use client";

import type { ParseReservationOutput } from "@contracts/index.js";
import { Plus, Trash2 } from "lucide-react";
import { useId, useRef, useState } from "react";
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
  SELECT_LABELS,
  type SelectFieldName,
} from "./lib/reservation-form";
import { ManualInputDivider, TabHeading } from "./screen-layout";

/** 同行者の行ひとつ。**AI は埋めない**ので `FieldSource` を持たない（#68）。 */
type CompanionRow = { id: string; name: string };

export function ReservationPanel() {
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  /*
    同行者とICカード利用枚数は出力契約に載せず、AI にも埋めさせない（#68）。
    `FormState` の外に置くのはそのため — 中に入れると `applyToForm` の写す規則が
    掛かる欄に見え、「AI が推測すべき値ではない」という判断がコードから消える。
  */
  const [companions, setCompanions] = useState<CompanionRow[]>([]);
  const [cardCount, setCardCount] = useState("");
  // 行の識別子は React の key にしか使わないので、画面の中だけで連番を配る。
  const nextCompanionNumber = useRef(0);

  function setField(name: FieldName, value: string) {
    setForm((current) => ({ ...current, [name]: { value, source: "manual" } }));
  }

  function addCompanion() {
    const id = `companion-${nextCompanionNumber.current}`;
    nextCompanionNumber.current += 1;
    setCompanions((current) => [...current, { id, name: "" }]);
  }

  function removeCompanion(id: string) {
    setCompanions((current) => current.filter((row) => row.id !== id));
  }

  function setCompanionName(id: string, name: string) {
    setCompanions((current) =>
      current.map((row) => (row.id === id ? { ...row, name } : row)),
    );
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
    // 同行者と利用枚数も戻す。「最初からやり直す」は AI 由来の欄だけを消す操作
    // ではなく、フォームを初期状態へ戻す操作である（手で入れた欄も消える）。
    setCompanions([]);
    setCardCount("");
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
        followUpPlaceholder="借りるのは10月16日の朝でした"
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
          {/*
            借りる日時・返す日時は日付ではなく時点なので `datetime-local`（#68）。
            出力契約が `YYYY-MM-DDTHH:mm` を保証するので、この欄の値の形と一致する。
          */}
          <Field
            name="borrow_at"
            type="datetime-local"
            state={form.borrow_at}
            onChange={setField}
          />
          <Field
            name="return_at"
            type="datetime-local"
            state={form.return_at}
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
          <SelectField
            name="transport"
            state={form.transport}
            onChange={setField}
          />
          <SelectField
            name="purpose"
            state={form.purpose}
            onChange={setField}
          />
        </div>

        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          <CardCountField value={cardCount} onChange={setCardCount} />
        </div>

        <CompanionRows
          rows={companions}
          onAdd={addCompanion}
          onRemove={removeCompanion}
          onChangeName={setCompanionName}
        />
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

/** 入力欄の見た目。見出しの下に置く欄は `mt-1.5` を足す（同行者の行は詰める）。 */
const INPUT_CLASS =
  "w-full rounded-md border border-solid-gray-600 bg-white px-3 py-2 text-dns-16N-130 text-solid-gray-900";

/** 欄の見出し。ラベル・AI バッジ・「消す」の並びは全欄で同じ。 */
function FieldHeader({
  htmlFor,
  label,
  source,
  onClear,
}: {
  htmlFor: string;
  label: string;
  source?: FieldSource;
  onClear?: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <label htmlFor={htmlFor} className="text-dns-14M-130 text-solid-gray-900">
        {label}
      </label>
      {source === "ai" && <AiBadge />}
      {onClear !== undefined && <ClearButton onClick={onClear} />}
    </div>
  );
}

type FieldProps = {
  name: FieldName;
  state: { value: string; source: FieldSource };
  onChange: (name: FieldName, value: string) => void;
};

function Field({
  name,
  type,
  state,
  onChange,
}: FieldProps & { type: "datetime-local" | "text" }) {
  const id = useId();
  return (
    <div>
      <FieldHeader
        htmlFor={id}
        label={FIELD_LABELS[name]}
        source={state.source}
        onClear={state.value === "" ? undefined : () => onChange(name, "")}
      />
      <input
        id={id}
        type={type}
        value={state.value}
        onChange={(event) => onChange(name, event.target.value)}
        className={`mt-1.5 ${INPUT_CLASS}`}
      />
    </div>
  );
}

/**
 * 選択肢の欄（交通手段・利用目的）。値は契約のもの、表示は職員が読む語。
 *
 * 表示名の対応は `lib/reservation-form.ts` が持つ（プレビューが同じ表を引く）。
 */
function SelectField({
  name,
  state,
  onChange,
}: Omit<FieldProps, "name"> & { name: SelectFieldName }) {
  const id = useId();
  return (
    <div>
      <FieldHeader
        htmlFor={id}
        label={FIELD_LABELS[name]}
        source={state.source}
        onClear={state.value === "" ? undefined : () => onChange(name, "")}
      />
      <select
        id={id}
        value={state.value}
        onChange={(event) => onChange(name, event.target.value)}
        className={`mt-1.5 ${INPUT_CLASS}`}
      >
        <option value="">未選択</option>
        {Object.entries(SELECT_LABELS[name]).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * ICカードの利用枚数。**AI は埋めない**ので AI バッジを持たない（#68）。
 */
function CardCountField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <div>
      <FieldHeader
        htmlFor={id}
        label="ICカード利用枚数"
        onClear={value === "" ? undefined : () => onChange("")}
      />
      <input
        id={id}
        type="number"
        min={1}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={`mt-1.5 ${INPUT_CLASS}`}
      />
    </div>
  );
}

/**
 * 同行者。行として足したり消したりする（#68）。**AI は埋めない。**
 *
 * 何人になるか決まっていないので固定の欄にできない。行が1つも無い状態を初期値に
 * するのは、同行者がいない出張のほうが普通で、空行が1つあると「埋めるべき欄」に
 * 見えるため。
 */
function CompanionRows({
  rows,
  onAdd,
  onRemove,
  onChangeName,
}: {
  rows: CompanionRow[];
  onAdd: () => void;
  onRemove: (id: string) => void;
  onChangeName: (id: string, name: string) => void;
}) {
  return (
    <fieldset className="mt-5">
      <legend className="text-dns-14M-130 text-solid-gray-900">同行者</legend>
      {rows.length === 0 && (
        <p className="mt-1.5 text-dns-14N-130 text-solid-gray-600">
          同行者はいません。
        </p>
      )}
      <ul className="mt-1.5 grid gap-2">
        {rows.map((row, index) => (
          <li key={row.id} className="flex items-center gap-2">
            <input
              type="text"
              value={row.name}
              aria-label={`同行者${index + 1}`}
              onChange={(event) => onChangeName(row.id, event.target.value)}
              className={INPUT_CLASS}
            />
            <button
              type="button"
              onClick={() => onRemove(row.id)}
              aria-label={`同行者${index + 1}を削除`}
              className="shrink-0 rounded-md border border-solid-gray-600 p-2 text-solid-gray-600"
            >
              <Trash2 aria-hidden="true" className="size-4" />
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={onAdd}
        className="mt-2 flex items-center gap-1 rounded-md border border-solid-gray-600 px-3 py-2 text-dns-14M-130 text-solid-gray-900"
      >
        <Plus aria-hidden="true" className="size-4" />
        同行者を追加
      </button>
    </fieldset>
  );
}
