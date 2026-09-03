"use client";

import type { ParseCandidatesOutput } from "@contracts/index.js";
import { useId, useRef, useState } from "react";
import { AiChatPanel } from "./ai-chat-panel";
import { AiBadge, type FieldSource } from "./field-source";
import { CANDIDATES_TASK_ID } from "./lib/api";

/**
 * 会議候補日のフォームの状態モデル。候補日程の**配列**である点が交通ICと違う。
 *
 * `id` は React の key と `<label>` の紐づけのために持つ、画面だけの識別子。
 * 出力契約にも BFF へのリクエストにも乗らない（ADR-003: Runtime へ渡すのは
 * 自然文だけで、画面が持っているフォームの状態は渡さない）。
 */
type CandidateRow = {
  id: string;
  date: string;
  start_time: string;
  end_time: string;
  source: FieldSource;
};

type CandidateField = "date" | "start_time" | "end_time";

/**
 * 非AI経路の起点。空の1行から始めれば、AI を一度も呼ばずに手で埋めきれる。
 *
 * id を固定値にするのは SSG のため。初期状態で乱数や連番を採ると、
 * ビルド時に描いた HTML とブラウザの初回描画が食い違う。
 */
const INITIAL_ROWS: CandidateRow[] = [
  { id: "row-0", date: "", start_time: "", end_time: "", source: "manual" },
];

function isBlank(row: CandidateRow): boolean {
  return row.date === "" && row.start_time === "" && row.end_time === "";
}

export function CandidatesPanel() {
  const [rows, setRows] = useState<CandidateRow[]>(INITIAL_ROWS);
  // 初期行の id と衝突しない位置から始める。
  const nextRowNumber = useRef(INITIAL_ROWS.length);

  function newRowId(): string {
    const id = `row-${nextRowNumber.current}`;
    nextRowNumber.current += 1;
    return id;
  }

  function setField(id: string, field: CandidateField, value: string) {
    setRows((current) =>
      current.map((row) =>
        // 手を入れた行は AI 由来ではなくなる。バッジが消えることで、
        // どこまでが AI の出力そのままかが画面から分かる。
        row.id === id ? { ...row, [field]: value, source: "manual" } : row,
      ),
    );
  }

  function addRow() {
    setRows((current) => [
      ...current,
      {
        id: newRowId(),
        date: "",
        start_time: "",
        end_time: "",
        source: "manual",
      },
    ]);
  }

  function removeRow(id: string) {
    setRows((current) => current.filter((row) => row.id !== id));
  }

  function applyResult(result: ParseCandidatesOutput) {
    // 読み取れなかった場合（空配列）は何も触らない。職員が先に手で入れていた
    // 候補を消してしまわないため。何が足りなかったかは message が言う。
    if (result.candidates.length === 0) return;

    setRows((current) => [
      // 前回の AI 由来の行は新しい結果で置き換える（同じ条件を言い直したときに
      // 候補が二重に積み上がらない）。手で入れた行は残すが、まだ何も入っていない
      // 空行だけは畳む。
      ...current.filter((row) => row.source === "manual" && !isBlank(row)),
      ...result.candidates.map((candidate) => ({
        id: newRowId(),
        // 出力契約が YYYY-MM-DD / HH:mm を保証するので、`<input type="date">`
        // `<input type="time">` へそのまま渡せる。整形は要らない。
        date: candidate.date,
        start_time: candidate.start_time,
        end_time: candidate.end_time,
        source: "ai" as const,
      })),
    ]);
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_20rem]">
      <section className="rounded-lg border border-black/10 p-6 dark:border-white/15">
        <h2 className="text-lg font-semibold">会議候補日設定</h2>
        <p className="mt-1 text-sm text-black/60 dark:text-white/60">
          AI を使わずに、最初からこのフォームだけで候補を足せます。
        </p>

        <ul className="mt-6 grid gap-4">
          {rows.map((row, index) => (
            <li key={row.id}>
              <CandidateFields
                row={row}
                index={index}
                onChange={setField}
                onRemove={removeRow}
              />
            </li>
          ))}
        </ul>

        {rows.length === 0 && (
          <p className="mt-6 text-sm text-black/60 dark:text-white/60">
            候補日程がありません。下のボタンで足すか、AI に作らせてください。
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
        taskId={CANDIDATES_TASK_ID}
        description="会議の条件を文章で書くと、左に候補日程の列を作ります。"
        placeholder="来月の午後で3時間"
        onResult={applyResult}
      />
    </div>
  );
}

type CandidateFieldsProps = {
  row: CandidateRow;
  index: number;
  onChange: (id: string, field: CandidateField, value: string) => void;
  onRemove: (id: string) => void;
};

function CandidateFields({
  row,
  index,
  onChange,
  onRemove,
}: CandidateFieldsProps) {
  const dateId = useId();
  const startId = useId();
  const endId = useId();
  const position = index + 1;

  return (
    <div className="rounded-md border border-black/10 p-4 dark:border-white/15">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">候補 {position}</span>
        {row.source === "ai" && <AiBadge />}
        <button
          type="button"
          onClick={() => onRemove(row.id)}
          className="ml-auto text-xs text-black/50 underline underline-offset-2 dark:text-white/50"
        >
          削除
        </button>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
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
            onChange={(event) => onChange(row.id, "date", event.target.value)}
            className="mt-1 w-full rounded-md border border-black/15 bg-transparent px-3 py-2 text-sm dark:border-white/20"
          />
        </div>
        <div>
          <label
            htmlFor={startId}
            className="text-xs text-black/60 dark:text-white/60"
          >
            開始時刻
          </label>
          <input
            id={startId}
            type="time"
            value={row.start_time}
            onChange={(event) =>
              onChange(row.id, "start_time", event.target.value)
            }
            className="mt-1 w-full rounded-md border border-black/15 bg-transparent px-3 py-2 text-sm dark:border-white/20"
          />
        </div>
        <div>
          <label
            htmlFor={endId}
            className="text-xs text-black/60 dark:text-white/60"
          >
            終了時刻
          </label>
          <input
            id={endId}
            type="time"
            value={row.end_time}
            onChange={(event) =>
              onChange(row.id, "end_time", event.target.value)
            }
            className="mt-1 w-full rounded-md border border-black/15 bg-transparent px-3 py-2 text-sm dark:border-white/20"
          />
        </div>
      </div>
    </div>
  );
}
