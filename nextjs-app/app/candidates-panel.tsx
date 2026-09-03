"use client";

import type { ParseCandidatesOutput } from "@contracts/index.js";
import { useId, useRef, useState } from "react";
import { AiChatPanel } from "./ai-chat-panel";
import {
  AiBadge,
  type ApplyReport,
  type FieldSource,
  NOTHING_APPLIED,
} from "./field-source";
import { CANDIDATES_TASK_ID } from "./lib/api";

/**
 * 職員が直接編集する欄。出力契約の候補日程から導き、UI 側で列挙し直さない
 * （契約に欄が増減したとき、型検査がこの画面まで届くようにする）。
 */
type CandidateField = keyof ParseCandidatesOutput["candidates"][number];

/**
 * 候補日程タブのフォームの状態モデル。候補日程の**配列**である点が交通ICと違う。
 *
 * 欄ごとに `{value, source}` を持つ形は交通ICと揃える。タブ間で共有するのは
 * この「AI 由来か手入力か」の印の付け方だけで、配列という入れ物は共有しない。
 *
 * `id` は React の key と `<label>` の紐づけのために持つ、画面だけの識別子。
 * 出力契約にも BFF へのリクエストにも乗らない（ADR-003: Runtime へ渡すのは
 * 自然文だけで、画面が持っているフォームの状態は渡さない）。
 */
type CandidateRow = {
  id: string;
  fields: Record<CandidateField, { value: string; source: FieldSource }>;
};

function blankRow(id: string): CandidateRow {
  return {
    id,
    fields: {
      date: { value: "", source: "manual" },
      start_time: { value: "", source: "manual" },
      end_time: { value: "", source: "manual" },
    },
  };
}

/**
 * バッジを出すかどうか。欄がひとつでも AI 由来なら出す。
 *
 * WHY: 日付だけ直して時刻は AI のまま、という状態で印が消えると、AI が出した
 * 値が手入力に見えてしまう（統制「透明性」が守りたいのは逆の向き）。
 */
function hasAiField(row: CandidateRow): boolean {
  return Object.values(row.fields).some((field) => field.source === "ai");
}

/** 職員が実際に何か書き込んだ行か。AI の出力を作り直すときに残す対象。 */
function hasManualInput(row: CandidateRow): boolean {
  return Object.values(row.fields).some(
    (field) => field.value !== "" && field.source === "manual",
  );
}

/**
 * 非AI経路の起点。空の1行から始めれば、AI を一度も呼ばずに手で埋めきれる。
 *
 * id を固定値にするのは SSG のため。初期状態で乱数や連番を採ると、
 * ビルド時に描いた HTML とブラウザの初回描画が食い違う。
 */
const INITIAL_ROWS: CandidateRow[] = [blankRow("row-0")];

/**
 * 候補日程タブの状態を外から持てるようにしたもの。
 *
 * WHY: 参加可否タブが○×を付ける対象は、このタブが持っている候補日程の日付である。
 * どちらかのタブの内側に状態を置くと相手から見えないので、状態の持ち主を
 * `FormEchoTabs` に上げる。**状態モデルの定義はこのファイルに残す**（#23
 * Implementation Decisions: フォームの状態モデルはタブごとに分ける）。上がったのは
 * 置き場所だけで、参加可否タブが受け取るのも `CandidateRow` ではなく日付の列に留める。
 */
export type CandidateRowsApi = {
  rows: CandidateRow[];
  setField: (id: string, field: CandidateField, value: string) => void;
  addRow: () => void;
  removeRow: (id: string) => void;
  applyResult: (result: ParseCandidatesOutput) => ApplyReport;
  reset: () => void;
};

/**
 * 参加可否タブへ渡す候補日程の日付。
 *
 * 空欄と重複を落とす。空欄を渡すと、日付を入れていない行が参加可否タブに
 * 「日付の無い候補日程」として並んでしまう。
 */
export function candidateDates(rows: CandidateRow[]): string[] {
  return [
    ...new Set(
      rows.map((row) => row.fields.date.value).filter((value) => value !== ""),
    ),
  ];
}

/**
 * 作り直しで何が入れ替わったかを言う。
 *
 * WHY: 件数だけだと「水曜は避けたい」で何が外れたのかが分からず、10件が10件に
 * 変わったときは**変わっていないのと見分けが付かない**。他のタブは項目名を挙げる
 * ので、ここも日付を挙げて揃える。写像そのものは素直な代入のままで、これは報告の
 * ためだけの計算（#23: 写像に条件分岐を育てない）。
 *
 * 時刻だけが動いた場合も拾うため、変化の有無は日付ではなく3項目の組で見る。
 */
function describeChange(
  replaced: CandidateRow[],
  candidates: ParseCandidatesOutput["candidates"],
): string[] {
  const before = replaced.map(
    (row) =>
      `${row.fields.date.value} ${row.fields.start_time.value}-${row.fields.end_time.value}`,
  );
  const after = candidates.map(
    (candidate) =>
      `${candidate.date} ${candidate.start_time}-${candidate.end_time}`,
  );
  if (
    before.length === after.length &&
    before.every((s, i) => s === after[i])
  ) {
    return [];
  }

  const beforeDates = replaced.map((row) => row.fields.date.value);
  const afterDates = candidates.map((candidate) => candidate.date);
  const added = afterDates.filter((date) => !beforeDates.includes(date));
  const removed = beforeDates.filter((date) => !afterDates.includes(date));

  const changes: string[] = [];
  if (added.length > 0) changes.push(`追加 ${added.join("・")}`);
  if (removed.length > 0) changes.push(`削除 ${removed.join("・")}`);
  // 日付の出入りが無く時刻だけ動いた場合。上の突き合わせは通っているので何かは変わっている。
  if (changes.length === 0) changes.push("時刻を変更");

  return [`候補日程 ${afterDates.length}件（${changes.join("、")}）`];
}

export function useCandidateRows(): CandidateRowsApi {
  const [rows, setRows] = useState<CandidateRow[]>(INITIAL_ROWS);
  // 初期行の id と衝突しない位置から始める。
  const nextRowNumber = useRef(INITIAL_ROWS.length);

  /** 行 id を配る。setState の updater は純粋に保つので、必ず外側で呼ぶ。 */
  function takeRowIds(count: number): string[] {
    const ids = Array.from(
      { length: count },
      (_, offset) => `row-${nextRowNumber.current + offset}`,
    );
    nextRowNumber.current += count;
    return ids;
  }

  function setField(id: string, field: CandidateField, value: string) {
    setRows((current) =>
      current.map((row) =>
        row.id === id
          ? {
              ...row,
              // 手を入れた欄だけが AI 由来ではなくなる。同じ行の他の欄は
              // AI のままなので、印もその欄の分だけ落とす。
              fields: { ...row.fields, [field]: { value, source: "manual" } },
            }
          : row,
      ),
    );
  }

  function addRow() {
    const [id] = takeRowIds(1);
    setRows((current) => [...current, blankRow(id)]);
  }

  function removeRow(id: string) {
    setRows((current) => current.filter((row) => row.id !== id));
  }

  /**
   * 「水曜は避けたい」のような追加の指示で候補日程の列を作り直す。
   *
   * **守る単位は行**（交通ICは欄単位）。欄ごとに混ぜられないのは、作り直された列と
   * 既にある行を対応付ける手がかりが無いため — 行の識別子は画面だけのもので出力契約に
   * 乗らない（ADR-003）ので、AI が返した3件目が既にある3行目の作り直しなのか別物なのか
   * を知る方法がない。職員が1欄でも書き込んだ行はその行ごと残す。
   */
  function applyResult(result: ParseCandidatesOutput): ApplyReport {
    // 読み取れなかった場合（空配列）は何も触らない。職員が先に手で入れていた
    // 候補日程を消してしまわないため。何が足りなかったかは message が言う。
    if (result.candidates.length === 0) return NOTHING_APPLIED;

    const ids = takeRowIds(result.candidates.length);
    // 手つかずの AI 由来の行は新しい結果で置き換える（同じ条件を言い直したときに
    // 候補日程が二重に積み上がらない）。職員が何か書き込んだ行は、AI が埋めた値を
    // 直したものであっても残す。空のままの行だけは畳む。
    const kept = rows.filter(hasManualInput);
    // 置き換えられる（= 手つかずの AI 由来の）行。何が入れ替わったかを言うために取る。
    const replaced = rows.filter((row) => !hasManualInput(row));
    setRows([
      ...kept,
      ...result.candidates.map((candidate, index) => ({
        id: ids[index],
        fields: {
          // 出力契約が YYYY-MM-DD / HH:mm を保証するので、`<input type="date">`
          // `<input type="time">` へそのまま渡せる。整形は要らない。
          date: { value: candidate.date, source: "ai" as const },
          start_time: { value: candidate.start_time, source: "ai" as const },
          end_time: { value: candidate.end_time, source: "ai" as const },
        },
      })),
    ]);

    return {
      updated: describeChange(replaced, result.candidates),
      preserved: kept.length > 0 ? [`手を入れた候補日程 ${kept.length}件`] : [],
    };
  }

  /**
   * 行 id の採番は戻さない。戻すと、作り直しの直後に足した行が消えた行と同じ id を
   * 持ちうる（React の key が重複する）。
   */
  function reset() {
    setRows(INITIAL_ROWS);
  }

  return { rows, setField, addRow, removeRow, applyResult, reset };
}

export function CandidatesPanel({
  candidates,
}: {
  candidates: CandidateRowsApi;
}) {
  const { rows, setField, addRow, removeRow, applyResult, reset } = candidates;

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_20rem]">
      <section className="rounded-lg border border-black/10 p-6 dark:border-white/15">
        <h2 className="text-lg font-semibold">会議候補日設定</h2>
        <p className="mt-1 text-sm text-black/60 dark:text-white/60">
          AI を使わずに、最初からこのフォームだけで候補日程を足せます。
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
        description="会議の条件を文章で書くと、左に候補日程の列を作ります。条件を足して作り直させることもできます。"
        placeholder="来月の午後で3時間"
        followUpPlaceholder="水曜は避けたい"
        onResult={applyResult}
        onReset={reset}
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

  return (
    <div className="rounded-md border border-black/10 p-4 dark:border-white/15">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">候補日程 {index + 1}</span>
        {hasAiField(row) && <AiBadge />}
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
            value={row.fields.date.value}
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
            value={row.fields.start_time.value}
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
            value={row.fields.end_time.value}
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
