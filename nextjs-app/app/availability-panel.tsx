"use client";

import type { ParseAvailabilityOutput } from "@contracts/index.js";
import { useId, useRef, useState } from "react";
import { AiChatPanel } from "./ai-chat-panel";
import { AiBadge, type FieldSource } from "./field-source";
import { AVAILABILITY_TASK_ID } from "./lib/api";

/**
 * 参加可否タブのフォームの状態モデル。
 *
 * 候補日程タブと同じ「配列」だが、状態モデルは共有しない（#23 Implementation
 * Decisions）。こちらの1行は `{日付, 可否}` であって時刻を持たず、AI が埋めるのは
 * 可否だけで日付は必ず職員のものになる。共有するのは「AI 由来か手入力か」の印の
 * 付け方だけに留める。
 *
 * `id` は React の key と `<label>` の紐づけのための画面だけの識別子。この一覧は
 * Runtime へ渡さない（ADR-003: 渡すのは自然文だけ）。
 */
type AvailabilityRow = {
  id: string;
  /**
   * 可否を問う対象の日付。AI が埋めることはないので `{value, source}` にしない
   * ——「AI が入力」の印を付ける先が無い欄に、付けられる形だけ用意しない。
   */
  date: string;
  /**
   * 参加可否。未回答は `null`、それ以外は出力契約の `available` をそのまま持つ。
   *
   * 画面独自の列挙（`"yes" | "no"`）にしない。出力契約が既に○×の2値なので、
   * 別の型を挟むと写像が単純な代入でなくなり、AI の出力とフォーム状態の間に
   * 変換を挟むことになる（#23 Testing Decisions の「素直な代入に留める」）。
   */
  answer: { choice: boolean | null; source: FieldSource };
};

type PanelState = {
  rows: AvailabilityRow[];
  /**
   * 直近の AI 応答が返した参加可否。**落ちた分を描画時に導くために持つ。**
   *
   * WHY: ADR-003 は Runtime に候補日程の一覧を渡さないと決めたので、AI が候補日程に
   * 無い日付を答える経路は必ず起きうる。落ちた分を確定させて持つと、職員がその日付を
   * 候補日程に足した後も「無い」と言い続ける。応答そのものを持って毎回突き合わせ直せば、
   * 表示は常に今の候補日程の一覧と一致する。
   */
  lastAnswers: ParseAvailabilityOutput["availability"];
};

function blankRow(id: string): AvailabilityRow {
  return { id, date: "", answer: { choice: null, source: "manual" } };
}

/**
 * 非AI経路の起点。空の1行から始めれば、AI を一度も呼ばずに候補日程を足して
 * ○×を付けきれる。
 *
 * id を固定値にするのは SSG のため。初期状態で乱数や連番を採ると、ビルド時に
 * 描いた HTML とブラウザの初回描画が食い違う。
 */
const INITIAL_STATE: PanelState = {
  rows: [blankRow("row-0")],
  lastAnswers: [],
};

export function AvailabilityPanel() {
  const [{ rows, lastAnswers }, setState] = useState<PanelState>(INITIAL_STATE);
  // 初期行の id と衝突しない位置から始める。
  const nextRowNumber = useRef(INITIAL_STATE.rows.length);

  /** 行 id を配る。setState の updater は純粋に保つので、必ず外側で呼ぶ。 */
  function takeRowId(): string {
    const id = `row-${nextRowNumber.current}`;
    nextRowNumber.current += 1;
    return id;
  }

  function setDate(id: string, date: string) {
    setState((current) => ({
      ...current,
      rows: current.rows.map((row) =>
        row.id === id
          ? {
              ...row,
              date,
              // AI が答えたのは前の日付に対する可否なので、日付を変えると宙に浮く。
              // 印だけ落として値を残すと、職員が選んでいない○×が手入力に見える。
              // 手入力の可否は職員自身の答えなので、日付を直しても残す。
              answer:
                row.answer.source === "ai"
                  ? { choice: null, source: "manual" }
                  : row.answer,
            }
          : row,
      ),
    }));
  }

  function setAnswer(id: string, choice: boolean) {
    setState((current) => ({
      ...current,
      rows: current.rows.map((row) =>
        row.id === id ? { ...row, answer: { choice, source: "manual" } } : row,
      ),
    }));
  }

  function addRow() {
    const id = takeRowId();
    setState((current) => ({
      ...current,
      rows: [...current.rows, blankRow(id)],
    }));
  }

  function removeRow(id: string) {
    setState((current) => ({
      ...current,
      rows: current.rows.filter((row) => row.id !== id),
    }));
  }

  /**
   * AI が返した日付を自分の候補日程の一覧に当てる（ADR-003 の突き合わせ）。
   *
   * 行を足したり消したりはしない。AI が答えるのは「既にある候補日程への可否」で
   * あって候補日程そのものではないため。
   */
  function applyResult(result: ParseAvailabilityOutput) {
    setState((current) => {
      const answers = new Map(
        result.availability.map((entry) => [entry.date, entry.available]),
      );
      return {
        rows: current.rows.map((row) => {
          const available = answers.get(row.date);
          return available === undefined
            ? row
            : { ...row, answer: { choice: available, source: "ai" as const } };
        }),
        lastAnswers: result.availability,
      };
    });
  }

  // 突き合わせに失敗した分。状態として持たず今の候補日程の一覧から導くので、
  // 職員が日付を足せばその場で消える。
  const dates = new Set(rows.map((row) => row.date));
  const dropped = lastAnswers.filter((entry) => !dates.has(entry.date));

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_20rem]">
      <section className="rounded-lg border border-black/10 p-6 dark:border-white/15">
        <h2 className="text-lg font-semibold">参加可否回答</h2>
        <p className="mt-1 text-sm text-black/60 dark:text-white/60">
          AI を使わずに、候補日程を足して手で○×を付けられます。
        </p>

        {dropped.length > 0 && (
          <div
            role="status"
            className="mt-6 rounded-md border border-amber-500/40 p-3 text-sm"
          >
            <p className="font-medium">
              候補日程に無い日付があり、次の回答は反映されませんでした。
            </p>
            <ul className="mt-2 list-disc pl-5">
              {dropped.map((entry) => (
                <li key={entry.date}>
                  {entry.date} —{" "}
                  {entry.available ? "○（参加できる）" : "×（参加できない）"}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-black/60 dark:text-white/60">
              この日付を候補日程に足して手で○×を付けるか、AI
              への指示を書き直してください。
            </p>
          </div>
        )}

        <ul className="mt-6 grid gap-4">
          {rows.map((row, index) => (
            <li key={row.id}>
              <AvailabilityFields
                row={row}
                index={index}
                onDateChange={setDate}
                onAnswerChange={setAnswer}
                onRemove={removeRow}
              />
            </li>
          ))}
        </ul>

        {rows.length === 0 && (
          <p className="mt-6 text-sm text-black/60 dark:text-white/60">
            候補日程がありません。下のボタンで足してください。
          </p>
        )}

        <button
          type="button"
          onClick={addRow}
          className="mt-6 rounded-md border border-black/15 px-4 py-2 text-sm font-medium dark:border-white/20"
        >
          候補日程を追加
        </button>
      </section>

      <AiChatPanel
        taskId={AVAILABILITY_TASK_ID}
        description="参加できる日・できない日を文章で書くと、左の候補日程に○×を付けます。「15日」のように月を省いた書き方は今日以降の直近の15日として解決されるので、別の月なら月から書いてください。"
        placeholder="15日と17日は大丈夫ですが16日は無理です"
        onResult={applyResult}
      />
    </div>
  );
}

type AvailabilityFieldsProps = {
  row: AvailabilityRow;
  index: number;
  onDateChange: (id: string, date: string) => void;
  onAnswerChange: (id: string, choice: boolean) => void;
  onRemove: (id: string) => void;
};

const CHOICES = [
  { value: "yes", choice: true, label: "○ 参加できる" },
  { value: "no", choice: false, label: "× 参加できない" },
] as const;

function AvailabilityFields({
  row,
  index,
  onDateChange,
  onAnswerChange,
  onRemove,
}: AvailabilityFieldsProps) {
  const dateId = useId();
  // ラジオは1行分でひとつのグループにする。行をまたいで同じ name になると、
  // 画面全体で1つしか選べなくなる。
  const groupName = useId();

  return (
    <div className="rounded-md border border-black/10 p-4 dark:border-white/15">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">候補日程 {index + 1}</span>
        <button
          type="button"
          onClick={() => onRemove(row.id)}
          className="ml-auto text-xs text-black/50 underline underline-offset-2 dark:text-white/50"
        >
          削除
        </button>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div>
          <label
            htmlFor={dateId}
            className="text-xs text-black/60 dark:text-white/60"
          >
            日付
          </label>
          <input
            id={dateId}
            type="date"
            value={row.date}
            onChange={(event) => onDateChange(row.id, event.target.value)}
            className="mt-1 w-full rounded-md border border-black/15 bg-transparent px-3 py-2 text-sm dark:border-white/20"
          />
        </div>
        <fieldset>
          {/*
            印は行の見出しではなく可否の側に付ける。日付は必ず職員のものなので、
            行全体に付けると「AI が日付も入れた」と読めてしまう。
          */}
          <legend className="flex items-center gap-2 text-xs text-black/60 dark:text-white/60">
            参加可否
            {row.answer.source === "ai" && <AiBadge />}
          </legend>
          <div className="mt-1 flex gap-4 py-2">
            {CHOICES.map(({ value, choice, label }) => (
              <label key={value} className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name={groupName}
                  value={value}
                  checked={row.answer.choice === choice}
                  onChange={() => onAnswerChange(row.id, choice)}
                />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
      </div>
    </div>
  );
}
