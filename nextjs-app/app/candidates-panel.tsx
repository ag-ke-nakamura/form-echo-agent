"use client";

import type {
  ParseAvailabilityInput,
  ParseCandidatesOutput,
} from "@contracts/index.js";
import { candidateIdOf } from "@contracts/meeting";
import { useId, useRef, useState } from "react";
import { AiAssistant } from "./ai-assistant";
import {
  AiBadge,
  type ApplyReport,
  type FieldSource,
  NOTHING_APPLIED,
} from "./field-source";
import { FormSection } from "./form-section";
import { CANDIDATES_TASK_ID } from "./lib/api";
import { candidateLimitReason } from "./lib/candidate-limit";
import {
  describeChange,
  newCandidatePreviewItems,
} from "./lib/candidates-form";
import { candidateRangeText, type MeetingInfo } from "./lib/meeting-info";
import { type MeetingInfoApi, MeetingInfoFields } from "./meeting-info";
import { ManualInputDivider, TabHeading } from "./screen-layout";

/**
 * 職員が直接編集する欄。出力契約の候補日程から導き、UI 側で列挙し直さない
 * （契約に欄が増減したとき、型検査がこの画面まで届くようにする）。
 *
 * 終了時刻はここに無い。候補日程は終了時刻を持たず、終わる時刻は会議の所要時間から
 * 導かれる（ADR-0005）。
 */
type CandidateField = keyof ParseCandidatesOutput["candidates"][number];

/**
 * 候補日程タブのフォームの状態モデル。候補日程の**配列**である点が交通ICと違う。
 *
 * 欄ごとに `{value, source}` を持つ形は交通ICと揃える。タブ間で共有するのは
 * この「AI 由来か手入力か」の印の付け方だけで、配列という入れ物は共有しない。
 *
 * `id` は**契約に載る識別子**になった（ADR-0005）。React の key と `<label>` の
 * 紐づけに使いつつ、タブ3・タブ4が候補日程を指す鍵としてそのまま Runtime へ渡る。
 * 発番するのはこの画面で、**AI は自分では作らない** — AI が選べる識別子は渡した
 * 一覧の中にしか無い。
 */
export type CandidateRow = {
  id: string;
  fields: Record<CandidateField, { value: string; source: FieldSource }>;
};

function blankRow(id: string): CandidateRow {
  return {
    id,
    fields: {
      date: { value: "", source: "manual" },
      start_time: { value: "", source: "manual" },
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
 * 識別子を固定値にするのは SSG のため。初期状態で乱数や連番を採ると、
 * ビルド時に描いた HTML とブラウザの初回描画が食い違う。形と発番は契約が持つ
 * （`contracts/meeting.ts` の `candidateIdOf`）— 画面だけの識別子だった頃は `row-0` で
 * 足りたが、いまは Runtime と BFF が同じ形で検査する。
 */
const INITIAL_ROWS: CandidateRow[] = [blankRow(candidateIdOf(0))];

/**
 * 候補日程タブの状態を外から持てるようにしたもの。
 *
 * WHY: 参加可否タブが答える対象は、このタブが持っている候補日程である。どちらかの
 * タブの内側に状態を置くと相手から見えないので、状態の持ち主を `FormEchoTabs` に上げる。
 * **状態モデルの定義はこのファイルに残す**（#23 Implementation Decisions:
 * フォームの状態モデルはタブごとに分ける）。
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
 * 契約に載る形の候補日程ひとつ。入力契約から導き、画面側で書き写さない
 * （契約に欄が増減したとき、型検査がこの画面まで届くようにする）。
 */
export type SelectedCandidate = ParseAvailabilityInput["candidates"][number];

/**
 * 他のタブと Runtime へ渡す候補日程。
 *
 * 日付か開始時刻が空の行を落とす。埋まっていない行を渡すと、参加可否タブに
 * 「日付の無い候補日程」が並び、Runtime へは入力契約に適合しない `input` が飛ぶ。
 */
export function selectedCandidates(rows: CandidateRow[]): SelectedCandidate[] {
  return rows
    .filter(
      (row) =>
        row.fields.date.value !== "" && row.fields.start_time.value !== "",
    )
    .map((row) => ({
      id: row.id,
      date: row.fields.date.value,
      start_time: row.fields.start_time.value,
    }));
}

export function useCandidateRows(): CandidateRowsApi {
  const [rows, setRows] = useState<CandidateRow[]>(INITIAL_ROWS);
  // 初期行の id と衝突しない位置から始める。
  const nextRowNumber = useRef(INITIAL_ROWS.length);

  /** 識別子を配る。setState の updater は純粋に保つので、必ず外側で呼ぶ。 */
  function takeRowIds(count: number): string[] {
    const ids = Array.from({ length: count }, (_, offset) =>
      candidateIdOf(nextRowNumber.current + offset),
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
   * 既にある行を対応付ける手がかりが無いため — AI は候補日程の識別子を返さない
   * （返せない。作っているのは新しい候補日程で、既存の識別子を選ぶ場面ではない）ので、
   * AI が返した3件目が既にある3行目の作り直しなのか別物なのかを知る方法がない。
   * 職員が1欄でも書き込んだ行はその行ごと残す。
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
        },
      })),
    ]);

    return {
      /*
        行そのものではなく日付と開始時刻に落として渡す。行の形はこのタブの状態モデル
        なので、`app/lib` から掘りに行かせない（`lib/candidates-form.ts`）。
      */
      updated: describeChange(
        replaced.map((row) => ({
          date: row.fields.date.value,
          start_time: row.fields.start_time.value,
        })),
        result.candidates,
      ),
      preserved: kept.length > 0 ? [`手を入れた候補日程 ${kept.length}件`] : [],
    };
  }

  /**
   * 識別子の採番は戻さない。戻すと、作り直しの直後に足した行が消えた行と同じ識別子を
   * 持ちうる（React の key が重複し、参加可否タブとタブ4の突き合わせも壊れる）。
   */
  function reset() {
    setRows(INITIAL_ROWS);
  }

  return { rows, setField, addRow, removeRow, applyResult, reset };
}

export function CandidatesPanel({
  candidates,
  meetingInfo,
}: {
  candidates: CandidateRowsApi;
  meetingInfo: MeetingInfoApi;
}) {
  const { rows, setField, addRow, removeRow, applyResult, reset } = candidates;
  /*
    上限は入力契約が持つ（`contracts/meeting.ts`）。足せてしまうと、超えた瞬間に
    タブ3・タブ4の AI だけが INVALID_INPUT で使えなくなり、画面のどこにも
    「多すぎる」と出ない。
  */
  const limitReason = candidateLimitReason(rows.length + 1);

  return (
    <div className="mx-auto max-w-3xl">
      <TabHeading>会議作成 STEP3: 候補日程</TabHeading>

      <MeetingInfoFields meetingInfo={meetingInfo} />

      <AiAssistant
        taskId={CANDIDATES_TASK_ID}
        /*
          所要時間だけを与件として送る（ADR-0005 の表）。既に選択済みの候補日程は
          送らない — 「来月の午後」→「火曜と木曜だけにして」という書き直しの往復は
          `sessionId` の会話履歴で成立する。
        */
        input={{ duration_minutes: meetingInfo.info.durationMinutes }}
        nonAiPathHint="AI を使わなくても、「候補日程を追加」から手で足せます。"
        description={
          "自然な言葉で候補日程を入力すると、AIが自動的にカレンダーに反映します。\n" +
          "例: 「来月の午後、できれば火曜か木曜」「10月第2週の14時から」"
        }
        placeholder="候補日程を自然な言葉で入力してください..."
        followUpPlaceholder="水曜は避けたい"
        submitLabel="AIで候補日程を生成"
        pendingLabel="生成中..."
        generatingMessage="AIが候補日程を生成しています..."
        /*
          設計書 3.6.5節は「カレンダーに反映」だが、そのカレンダーはまだ無い（#69）。
          区切り線の文言と同じ扱いにする — **その非AI経路が設計書の形になったタブだけが
          設計書の文言を名乗る**（`screen-layout.tsx`）。
        */
        applyLabel="この内容で候補日程に入力"
        emptyItemText="（生成できませんでした）"
        previewItems={(result) =>
          newCandidatePreviewItems(
            result.candidates,
            meetingInfo.info.durationMinutes,
          )
        }
        onApply={applyResult}
        onReset={reset}
      />

      <ManualInputDivider />

      <FormSection taskId={CANDIDATES_TASK_ID}>
        <ul className="grid gap-4">
          {rows.map((row, index) => (
            <li key={row.id}>
              <CandidateFields
                row={row}
                index={index}
                durationMinutes={meetingInfo.info.durationMinutes}
                onChange={setField}
                onRemove={removeRow}
              />
            </li>
          ))}
        </ul>

        {rows.length === 0 && (
          <p className="text-dns-14N-130 text-solid-gray-700">
            候補日程がありません。下のボタンで足すか、AI に作らせてください。
          </p>
        )}

        <button
          type="button"
          onClick={addRow}
          disabled={limitReason !== null}
          className="mt-6 rounded-md border border-solid-gray-600 bg-white px-4 py-2 text-dns-14M-130 text-solid-gray-900 disabled:opacity-40"
        >
          候補日程を追加
        </button>
        {limitReason !== null && (
          <p className="mt-1 text-dns-12N-130 text-solid-gray-600">
            {limitReason}
          </p>
        )}
      </FormSection>
    </div>
  );
}

type CandidateFieldsProps = {
  row: CandidateRow;
  index: number;
  durationMinutes: MeetingInfo["durationMinutes"];
  onChange: (id: string, field: CandidateField, value: string) => void;
  onRemove: (id: string) => void;
};

function CandidateFields({
  row,
  index,
  durationMinutes,
  onChange,
  onRemove,
}: CandidateFieldsProps) {
  const dateId = useId();
  const startId = useId();

  return (
    <div className="rounded-md border border-solid-gray-300 p-4">
      <div className="flex items-center gap-2">
        <span className="text-dns-14M-130 text-solid-gray-900">
          候補日程 {index + 1}
        </span>
        {hasAiField(row) && <AiBadge />}
        <button
          type="button"
          onClick={() => onRemove(row.id)}
          className="ml-auto text-dns-12N-130 text-solid-gray-600 underline underline-offset-2"
        >
          削除
        </button>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <div>
          <label
            htmlFor={dateId}
            className="text-dns-12M-130 text-solid-gray-700"
          >
            日付
          </label>
          <input
            id={dateId}
            type="date"
            value={row.fields.date.value}
            onChange={(event) => onChange(row.id, "date", event.target.value)}
            className="mt-1 w-full rounded-md border border-solid-gray-600 bg-white px-3 py-2 text-dns-16N-130 text-solid-gray-900"
          />
        </div>
        <div>
          <label
            htmlFor={startId}
            className="text-dns-12M-130 text-solid-gray-700"
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
            className="mt-1 w-full rounded-md border border-solid-gray-600 bg-white px-3 py-2 text-dns-16N-130 text-solid-gray-900"
          />
        </div>
        {/*
          終了時刻は入力欄ではなく表示に変わった（ADR-0005）。所要時間から導かれる
          ので、ここで独立に選べると2つの与件が食い違う組を職員が作れてしまう。
          変えたいときに触る先は会議情報の「所要時間」であることが分かるよう、
          導出元をそのまま添える。
        */}
        <div>
          <span className="text-dns-12M-130 text-solid-gray-700">終了時刻</span>
          <p className="mt-1 px-3 py-2 text-dns-16N-130 text-solid-gray-900">
            <EndTime
              startTime={row.fields.start_time.value}
              durationMinutes={durationMinutes}
            />
          </p>
        </div>
      </div>
    </div>
  );
}

function EndTime({
  startTime,
  durationMinutes,
}: {
  startTime: string;
  durationMinutes: MeetingInfo["durationMinutes"];
}) {
  if (startTime === "") {
    return (
      <span className="text-solid-gray-600">開始時刻を入れると出ます</span>
    );
  }
  const range = candidateRangeText(startTime, durationMinutes);
  // 導けなかった場合、`candidateRangeText` は開始時刻だけを返す。日をまたぐ会議は
  // 無いものとして扱うので、そのまま置くと欄が黙って開始時刻を繰り返す。
  if (range === startTime) {
    return (
      <span className="text-solid-gray-600">
        日をまたぐため所要時間ぶんが取れません
      </span>
    );
  }
  return (
    <>
      {range.split("–")[1]}
      <span className="ml-2 text-dns-12N-130 text-solid-gray-600">
        （所要時間 {durationMinutes}分）
      </span>
    </>
  );
}
