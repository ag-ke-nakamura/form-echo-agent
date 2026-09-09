"use client";

import type { ParseReservationOutput } from "@/lib/contracts/types";
import { Plus, Trash2 } from "lucide-react";
import { type ChangeEvent, useId, useState, useSyncExternalStore } from "react";
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
  applyToReservation,
  cardCount,
  CHOICE_LABELS,
  type ChoiceFieldName,
  type CompanionRow,
  DEPART_TIME_STEP_SECONDS,
  departAtParts,
  EMPTY_RESERVATION,
  FARE_UNIT,
  FIELD_LABELS,
  type FieldName,
  type FormState,
  joinDepartAt,
  PLACE_PLACEHOLDER,
  PLACE_SUGGESTIONS,
  preprintDepartDate,
  removeCompanion,
  type ReservationState,
  reservationBreakdown,
  reservationInput,
  reservationPreviewItems,
  resetReservation,
  setCardCount,
  setCompanionName,
  setFieldValue,
  todayOf,
} from "./reservation-form";
import { ManualInputDivider, TabHeading } from "@/components/screen-layout";

export function ReservationPanel() {
  /*
    状態モデルと遷移は `reservation-form.ts`（#167）。同行者とICカード利用枚数も
    そこにある — 行の足し引きという判断を持つので、画面に置くと画面を描かない限り
    確かめられない。
  */
  /*
    出発日時の当日プレプリント（#175）は `useState` の初期値には置けない。今日が
    決まるのはブラウザで描くときで（SSG のサーバー側の描画でも初期値は1度作られ、
    ビルド機の「今日」が HTML に焼き付く）、それは `useState` より後になる。

    **だから描くときと更新するときの両方でプレプリントを通す。** `preprintDepartDate`
    は既定値のまま空の欄しか埋めないので何度通しても同じで、「最初からやり直す」で
    空へ戻った直後も次の描画で当日が入る。
  */
  const today = useToday();
  const [stored, setStored] = useState(EMPTY_RESERVATION);
  const reservation = preprintDepartDate(stored, today);
  const { fields } = reservation;

  function update(next: (current: ReservationState) => ReservationState) {
    setStored((current) => next(preprintDepartDate(current, today)));
  }

  function setField(name: FieldName, value: string) {
    update((current) => setFieldValue(current, name, value));
  }

  /**
   * WHY: 判断を `applyToForm`（`reservation-form.ts`）に出して setState の updater
   * に置かないのは、何を更新して何を守ったかを**同期で**返す必要があるため（updater は
   * 純粋に保つ約束があり、実行も後になる）。
   */
  function applyResult(result: ParseReservationOutput): ApplyReport {
    const { next, report } = applyToReservation(reservation, result);
    setStored(next);
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
          "同行者は人数ぶんの空の行を作ります。氏名は手で入力してください。"
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
        previewItems={(result) => reservationPreviewItems(result, reservation)}
        /*
          AI提案の内訳（#172）。欄と対応しない行なので一覧とは別に渡す。いまの
          フォームは見ない — 何が入るかではなく AI が何を調べたかを言う領域である。
        */
        breakdown={reservationBreakdown}
        onApply={applyResult}
        onReset={() => update(resetReservation)}
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
          {/*
            出発日時は移動の話で、上の2欄（カードの貸借）とは別の概念（#175。
            CONTEXT.md「出発日時」）。日付と時刻の2つの入力を持つので2列ぶん使う。
          */}
          <div className="sm:col-span-2">
            <DepartAtField
              state={fields.depart_at}
              onChange={(value) => setField("depart_at", value)}
            />
          </div>
          {/*
            出発地・目的地は7駅から選べて自由記述もできる（#171）。同じ欄に両方を
            載せるので、選択肢は `<datalist>` の候補であって値域ではない。
          */}
          <Field
            name="origin"
            type="text"
            state={fields.origin}
            onChange={setField}
            placeholder={PLACE_PLACEHOLDER}
            suggestions={PLACE_SUGGESTIONS}
          />
          <Field
            name="destination"
            type="text"
            state={fields.destination}
            onChange={setField}
            placeholder={PLACE_PLACEHOLDER}
            suggestions={PLACE_SUGGESTIONS}
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
          {/*
            運賃は数値で入る（#169）。単位はラベルが持ち、値には混ぜない — 文字列の
            ままだと「約2000円」「1980円（往復）」が入りうる欄で、往復区分が往復なのに
            片道の額が入っていることを職員が目で確かめられない。

            但し書きが「見込み」を言う。用語は「1人あたり運賃（見込み）」だが、欄名は
            「（見込み）」を落とした短い形に決めた（#192）ので、額が概算であることを
            言う場所がラベルの外に要る。**手で直せることも同じ文が言う** — AI が経路を
            引けなかった回は空欄のまま残るので（`applyToForm` が null を触らない）、
            職員が自分で入れる欄だと分かっている必要がある。
          */}
          <Field
            name="transport_cost"
            type="number"
            unit={FARE_UNIT}
            // 契約と同じ値域（0以上の整数。#169）。負の運賃を打てる欄にしない。
            min={0}
            required
            note="AIが調べた見込みの額です。実額と違うときは手で直してください。"
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
            value={cardCount(reservation)}
            onChange={(override) =>
              update((current) => setCardCount(current, override))
            }
          />
        </div>

        <CompanionRows
          rows={reservation.companions}
          onAdd={() => update(addCompanion)}
          onRemove={(id) => update((current) => removeCompanion(current, id))}
          onChangeName={(id, name) =>
            update((current) => setCompanionName(current, id, name))
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
 * 欄の但し書き。
 *
 * WHY 画面に出すか: AI が何をして何をしないかは、応答からは読めない。同行者の氏名は
 * 契約に載らない（#176。参加者名をブラウザに留める ADR-0008 と同じ種類のデータ）ので
 * AI は空の行しか作らず、黙っていると職員には**AI が氏名を読み落としたのか初めから
 * 受け取っていないのか区別が付かない** — 同じ文を足して往復を繰り返すことになる。
 * Skill はモデルに `message` でこの2欄へ触れることを禁じているので、聞き返しからも
 * 分からない。
 */
function FieldNote({ id, children }: { id: string; children: string }) {
  return (
    <p id={id} className="mt-1 text-dns-12N-130 text-solid-gray-600">
      {children}
    </p>
  );
}

/** 入力欄の見た目。見出しの下に置く欄は `mt-1.5` を足す（同行者の行は詰める）。 */
const INPUT_CLASS =
  "w-full rounded-md border border-solid-gray-600 bg-white px-3 py-2 text-dns-16N-130 text-solid-gray-900";

/**
 * 必須の印（#169）。並びは正典の `temp/design/reservation-ai-screen-design.md` が
 * 示す形（5.2節の例の `1人あたり運賃（円） [必須] [AIが生成]`）で、印はラベルの
 * 直後・AI バッジの前に来る。**指南書は引かない** — ADR-0017 が指南書をこの正典への
 * 吸収先と決めており、吸収は #177 で終わっている。
 *
 * **検査はしない**（設計書 2.3節）。読み上げに名乗るのは入力側の `aria-required`
 * （`Field`）— 印の字面だけだとどの欄の印なのかが分からない。
 *
 * **色は `error-*` を借りている。** 必須の印はエラーではないが、トークンにある赤は
 * この1組だけである（`globals.css` は「設計書に出てくる分だけ」と決めているので
 * 足さない）。**置く場所の制約は設計書 7.3節**。
 *
 * **いま印が付くのは運賃だけである。** #169 の範囲が運賃1欄なのでそこに留めてあり、
 * 正典が求める残りの欄（出発地・目的地・往復区分）は設計書 12節「未着手の要求」にある。
 */
function RequiredBadge() {
  return (
    <span className="rounded bg-error-bg px-2 py-1 text-dns-12M-130 text-error-1">
      必須
    </span>
  );
}

/**
 * 欄の見出し。ラベル・必須の印・AI バッジ・「消す」の並びは全欄で同じ。
 *
 * `unit` はラベルに括って添える（#169）。数値入力の欄は値に単位を混ぜられないので、
 * 単位の置き場所がラベルしかない。**`FIELD_LABELS` には入れない** — あの表は反映の
 * 報告も引くので、報告が単位を名乗ることになる。
 */
function FieldHeader({
  htmlFor,
  label,
  unit,
  required,
  source,
  onClear,
}: {
  htmlFor: string;
  label: string;
  unit?: string;
  required?: boolean;
  source?: FieldSource;
  onClear?: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <label htmlFor={htmlFor} className="text-dns-14M-130 text-solid-gray-900">
        {unit === undefined ? label : `${label}（${unit}）`}
      </label>
      {required === true && <RequiredBadge />}
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

/**
 * 入力欄。`suggestions` を渡すと候補付きになる。
 *
 * WHY `<datalist>` か: 選択肢と自由記述を**同じ欄**に載せられる唯一の素の部品である
 * （#171）。`<select>` と入力欄を並べると職員がどちらに書くのかを選ぶことになり、
 * 選んだ値を入力欄へ写す判断が画面に生える。候補を選んでも `onChange` は普通に
 * 発火するので、`setFieldValue` を通って `"manual"` に落ちる。
 */
function Field({
  name,
  type,
  state,
  onChange,
  placeholder,
  suggestions,
  min,
  note,
  required,
  unit,
}: FieldProps & {
  type: "date" | "datetime-local" | "number" | "text" | "textarea";
  placeholder?: string;
  suggestions?: readonly string[];
  /** 数値入力の下限。**値域は欄の側の話**なので、この部品には持たせず呼び出し側が渡す。 */
  min?: number;
  note?: string;
  required?: boolean;
  unit?: string;
}) {
  const id = useId();
  const listId = useId();
  const noteId = `${id}-note`;
  const shared = {
    id,
    value: state.value,
    placeholder,
    "aria-describedby": note === undefined ? undefined : noteId,
    "aria-required": required,
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      onChange(name, event.target.value),
    className: `mt-1.5 ${INPUT_CLASS}`,
  };
  return (
    <div>
      <FieldHeader
        htmlFor={id}
        label={FIELD_LABELS[name]}
        unit={unit}
        required={required}
        source={state.source}
        onClear={state.value === "" ? undefined : () => onChange(name, "")}
      />
      {note !== undefined && <FieldNote id={noteId}>{note}</FieldNote>}
      {type === "textarea" ? (
        <textarea rows={2} {...shared} />
      ) : (
        <input
          type={type}
          min={min}
          list={suggestions === undefined ? undefined : listId}
          {...shared}
        />
      )}
      {suggestions !== undefined && (
        <datalist id={listId}>
          {suggestions.map((place) => (
            <option key={place} value={place} />
          ))}
        </datalist>
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
 * 出発日時（#175。CONTEXT.md「出発日時」）。**日付と時刻を別の入力に分ける。**
 *
 * WHY `datetime-local` 1つにしないか: プレプリントするのは当日の**日付だけ**である。
 * `datetime-local` は日付だけの値を持てないので、時刻に `00:00` を置くことになり、
 * 職員が決めていない深夜0時発が既定値として申請に乗る（Skill が `return_at` に
 * 「`18:00` のような既定の時刻を置かない」と書いているのと同じ理由）。
 *
 * **15分刻みはネイティブの `step` で出す**（専用の部品を作らない）。契約は刻みを
 * 縛らないので、AI が `10:07` を返した回はそのまま表示する — 刻みは職員が選ぶときの
 * 目安であって、値を弾く条件ではない。
 *
 * **画面に但し書きを置かない。** 「運賃は出発日時では変わらない」という規則の置き場所は
 * Skill である（#175 が Skill に書くことだけを求めている）。画面に足すと、同じ規則が
 * 2箇所に住む。
 */
function DepartAtField({
  state,
  onChange,
}: {
  state: FormState["depart_at"];
  onChange: (value: string) => void;
}) {
  const dateId = useId();
  const { date, time } = departAtParts(state.value);
  /*
    見出しは他の欄と同じ `FieldHeader` を使い、`<fieldset>` にしない。2つの入力を
    束ねる意味は「出発日時」という1つのラベルで足りており、並び（ラベル・AI バッジ・
    「消す」）を legend として書き直すと、全欄で同じという `FieldHeader` の前提が崩れる。
    見出しは日付側に結び付け、時刻側は `aria-label` で名乗る（用語集に無い「出発
    時刻」を作らず、「出発日時」の一部として読み上げさせる）。
  */
  return (
    <div>
      <FieldHeader
        htmlFor={dateId}
        label={FIELD_LABELS.depart_at}
        source={state.source}
        onClear={state.value === "" ? undefined : () => onChange("")}
      />
      <div className="mt-1.5 grid gap-5 sm:grid-cols-2">
        <input
          id={dateId}
          type="date"
          value={date}
          onChange={(event) => onChange(joinDepartAt(event.target.value, time))}
          className={INPUT_CLASS}
        />
        <input
          type="time"
          step={DEPART_TIME_STEP_SECONDS}
          aria-label="出発日時（時刻）"
          value={time}
          onChange={(event) => onChange(joinDepartAt(date, event.target.value))}
          className={INPUT_CLASS}
        />
      </div>
    </div>
  );
}

/**
 * 職員が見ている「今日」（`YYYY-MM-DD`）。**ブラウザで描くときだけ決まる**
 * （`null` は未確定）。
 *
 * WHY こう取るか: SSG なのでビルド時に描いた HTML とブラウザの初回描画が食い違って
 * はならず、ビルド機の「今日」は職員の「今日」ではない。`useSyncExternalStore` は
 * サーバー側の値（`null`）とブラウザ側の値を別に取れるので、React が食い違いを
 * 起こさずに描き直す。会議候補日設定タブのカレンダーの起点も同じ形で取る
 * （`use-candidate-calendar.ts`）。**共有せず両方に置く** — 共有先は top-level の
 * `lib/` しかなく（ADR-0016 の境界）、日付の整形1つのためにそこへ置くと、次の
 * 「共有したい」も同じ理由で溜まる。
 *
 * 返すのは日付の**文字列**である。オブジェクトを作ると呼ばれるたびに別物になり、
 * React が「snapshot が安定していない」と見て描き直し続ける。
 */
function useToday(): string | null {
  return useSyncExternalStore(
    subscribeToNothing,
    () => todayOf(new Date()),
    () => null,
  );
}

/** 今日は時計を読むだけで、変わったことを知らせる相手がいない。 */
function subscribeToNothing(): () => void {
  return () => {};
}

/**
 * ICカードの利用枚数。**同行者の行数から導く**（#176）。
 *
 * AI バッジを持たないのは、AI が埋める欄ではないため — 導出しているのは画面である。
 * 職員が打てば固定される（`setCardCount`）ので、自分のICカードを持っている同行者が
 * いる回もそのまま通る。
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
      <FieldNote id={noteId}>
        同行者の人数から自動で入ります。直せます。
      </FieldNote>
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
 * 同行者。行として足したり消したりする（#68）。**AI が作れるのは空の行だけ**（#176）。
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
      <FieldNote id={noteId}>
        氏名は AI が入力しません。手で入力してください。
      </FieldNote>
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
