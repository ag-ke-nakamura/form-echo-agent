"use client";

import type { ParseReservationOutput } from "@/lib/contracts/types";
import { Plus, Trash2 } from "lucide-react";
import { type ChangeEvent, useId, useState } from "react";
import { AiAssistant } from "@/components/ai-assistant/ai-assistant";
import {
  AiBadge,
  type ApplyReport,
  type FieldSource,
} from "@/components/ai-assistant/field-source";
import { FormSection } from "@/components/form-section";
import { RESERVATION_TASK_ID } from "@/lib/api";
import {
  addCompanion,
  applyToForm,
  CHOICE_LABELS,
  type ChoiceFieldName,
  type CompanionRow,
  EMPTY_RESERVATION,
  FIELD_LABELS,
  type FieldName,
  type FormState,
  removeCompanion,
  reservationInput,
  reservationPreviewItems,
  resetReservation,
  setCardCount,
  setCompanionName,
  setFieldValue,
} from "./reservation-form";
import { ManualInputDivider, TabHeading } from "@/components/screen-layout";

export function ReservationPanel() {
  /*
    状態モデルと遷移は `reservation-form.ts`（#167）。同行者とICカード利用枚数も
    そこにある — 行の足し引きという判断を持つので、画面に置くと画面を描かない限り
    確かめられない。
  */
  const [reservation, setReservation] = useState(EMPTY_RESERVATION);
  const { fields } = reservation;

  function setField(name: FieldName, value: string) {
    setReservation((current) => setFieldValue(current, name, value));
  }

  /**
   * WHY: 判断を `applyToForm`（`reservation-form.ts`）に出して setState の updater
   * に置かないのは、何を更新して何を守ったかを**同期で**返す必要があるため（updater は
   * 純粋に保つ約束があり、実行も後になる）。
   */
  function applyResult(result: ParseReservationOutput): ApplyReport {
    const { next, report } = applyToForm(fields, result);
    setReservation((current) => ({ ...current, fields: next }));
    return report;
  }

  return (
    <div className="mx-auto max-w-3xl">
      <TabHeading>交通ICカード予約申請</TabHeading>

      <TravelConditionFields
        state={fields.round_trip}
        onChange={(value) => setField("round_trip", value)}
      />

      <AiAssistant
        taskId={RESERVATION_TASK_ID}
        /*
          運賃の額を決める与件を毎回渡す（ADR-0017）。値だけでなく「職員が手で
          入れたか」も一緒に渡すのは ADR-0018 — 印が無いと、AI が手入力の欄を
          直しても画面が守り、フォームの値と運賃の計算根拠が食い違う。
        */
        input={reservationInput(fields)}
        nonAiPathHint="AI を使わなくても、すべての項目を手で埋められます。"
        description={
          "自然な言葉で予約内容を入力すると、AIが自動的にフォームに入力します。\n" +
          "例: 「来月15日から3泊4日で大阪出張、新幹線で往復」\n" +
          "追加指示は任意です。\n" +
          "同行者とICカード利用枚数は対象外です。手で入力してください。"
        }
        placeholder="予約内容を自然な言葉で入力してください..."
        followUpPlaceholder="返すのは18時です"
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
        previewItems={(result) => reservationPreviewItems(result, fields)}
        onApply={applyResult}
        onReset={() => setReservation(resetReservation)}
      />

      <ManualInputDivider />

      <FormSection taskId={RESERVATION_TASK_ID}>
        <div className="grid gap-5 sm:grid-cols-2">
          {/* 借りる日は #86 で時点から日付に戻した。返す日時は引き続き時点なので `datetime-local`（#68）。 */}
          <Field
            name="borrow_at"
            type="date"
            state={fields.borrow_at}
            onChange={setField}
          />
          <Field
            name="return_at"
            type="datetime-local"
            state={fields.return_at}
            onChange={setField}
          />
          <Field
            name="origin"
            type="text"
            state={fields.origin}
            onChange={setField}
          />
          <Field
            name="destination"
            type="text"
            state={fields.destination}
            onChange={setField}
          />
          {/* 移動経路は区間をまたぐ長い文字列になりうるので、2列ぶん使う（#86）。 */}
          <div className="sm:col-span-2">
            <Field
              name="route"
              type="textarea"
              state={fields.route}
              onChange={setField}
            />
          </div>
          <Field
            name="transport_cost"
            type="text"
            state={fields.transport_cost}
            onChange={setField}
          />
          <SelectField
            name="purpose"
            state={fields.purpose}
            onChange={setField}
          />
        </div>

        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          <CardCountField
            value={reservation.cardCount}
            onChange={(cardCount) =>
              setReservation((current) => setCardCount(current, cardCount))
            }
          />
        </div>

        <CompanionRows
          rows={reservation.companions}
          onAdd={() => setReservation(addCompanion)}
          onRemove={(id) =>
            setReservation((current) => removeCompanion(current, id))
          }
          onChangeName={(id, name) =>
            setReservation((current) => setCompanionName(current, id, name))
          }
        />
      </FormSection>
    </div>
  );
}

/**
 * 移動の条件（#168）。**AI入力アシスタントより上に置く。**
 *
 * WHY 上か: 往復区分は運賃の額を決める与件で、AI が走る前に決まっていないといけない
 * （会議タブ2の `MeetingInfoFields` と同じ形）。下に置くと、AI が返した運賃を後から
 * 倍にするかどうかという話になり、それは画面の仕事ではない。
 *
 * ラジオにするのは2択だから（会議の参加形式と同じ）。「未選択」を足さないのは、
 * 職員が選んでいない状態と片道を選んだ状態が同じ見た目になるため — 手を触れて
 * いないことは `source` が覚えていて、そちらは AI に届く（ADR-0018）。
 */
function TravelConditionFields({
  state,
  onChange,
}: {
  state: FormState["round_trip"];
  onChange: (value: string) => void;
}) {
  const headingId = useId();
  const groupName = useId();
  return (
    <section
      aria-labelledby={headingId}
      className="mb-6 rounded-lg border border-solid-gray-300 p-6"
    >
      {/* AI入力アシスタントと同じ節の重さ。あちらの見出しと同じトークンを使う。 */}
      <h3 id={headingId} className="text-std-20M-150 text-solid-gray-900">
        移動の条件
      </h3>
      <p className="mt-2 text-dns-14N-130 text-solid-gray-700">
        往復区分が、AIが調べる運賃を片道分にするか往復分にするかを決めます。
      </p>

      <fieldset className="mt-4">
        <legend className="flex items-center gap-2 text-dns-14M-130 text-solid-gray-900">
          往復区分
          {state.source === "ai" && <AiBadge />}
        </legend>
        <div className="mt-1.5 flex flex-wrap gap-4 py-1">
          {Object.entries(CHOICE_LABELS.round_trip).map(([value, label]) => (
            <label
              key={value}
              className="flex items-center gap-2 text-dns-16N-130 text-solid-gray-900"
            >
              <input
                type="radio"
                name={groupName}
                value={value}
                checked={state.value === value}
                onChange={() => onChange(value)}
              />
              {label}
            </label>
          ))}
        </div>
      </fieldset>
    </section>
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

/**
 * AI が埋めない欄の但し書き（#68）。
 *
 * WHY 画面に出すか: 同行者と利用枚数は出力契約に無いので、自然文に「田中さんと2人で」
 * と書いても行は増えない。画面が黙っていると、職員には**AI が読み落としたのか初めから
 * 対象外なのか区別が付かない** — 同じ文を足して往復を繰り返すことになる。SKILL.md は
 * モデルに `message` でこの2欄へ触れることを禁じているので、聞き返しからも分からない。
 *
 * 設計書 12章も「同行者情報のAI抽出」を**未対応**として将来の項目に挙げており、
 * 「対応しない」ではなく「いまは対象外」であることまで画面が言う必要はない。
 */
function ManualOnlyNote({ id }: { id: string }) {
  return (
    <p id={id} className="mt-1 text-dns-12N-130 text-solid-gray-600">
      この項目は AI が入力しません。手で入力してください。
    </p>
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
}: FieldProps & { type: "date" | "datetime-local" | "text" | "textarea" }) {
  const id = useId();
  const shared = {
    id,
    value: state.value,
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      onChange(name, event.target.value),
    className: `mt-1.5 ${INPUT_CLASS}`,
  };
  return (
    <div>
      <FieldHeader
        htmlFor={id}
        label={FIELD_LABELS[name]}
        source={state.source}
        onClear={state.value === "" ? undefined : () => onChange(name, "")}
      />
      {type === "textarea" ? (
        <textarea rows={2} {...shared} />
      ) : (
        <input type={type} {...shared} />
      )}
    </div>
  );
}

/**
 * 選択肢の欄（利用目的）。値は契約のもの、表示は職員が読む語。
 *
 * 表示名の対応は `reservation-form.ts` が持つ（プレビューが同じ表を引く）。
 */
function SelectField({
  name,
  state,
  onChange,
}: Omit<FieldProps, "name"> & { name: ChoiceFieldName }) {
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
        {Object.entries(CHOICE_LABELS[name]).map(([value, label]) => (
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
  const noteId = `${id}-note`;
  return (
    <div>
      <FieldHeader
        htmlFor={id}
        label="ICカード利用枚数"
        onClear={value === "" ? undefined : () => onChange("")}
      />
      <ManualOnlyNote id={noteId} />
      <input
        id={id}
        type="number"
        min={1}
        value={value}
        aria-describedby={noteId}
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
  const noteId = useId();
  return (
    <fieldset className="mt-5" aria-describedby={noteId}>
      <legend className="text-dns-14M-130 text-solid-gray-900">同行者</legend>
      <ManualOnlyNote id={noteId} />
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
