"use client";

import { AlertCircle, Info } from "lucide-react";
import { useState } from "react";
import { AiAssistant } from "@/components/ai-assistant/ai-assistant";
import { FormSection } from "@/components/form-section";
import { ManualInputDivider, TabHeading } from "@/components/screen-layout";
import { CANDIDATES_TASK_ID } from "@/lib/api";
import { candidateLimitReason } from "../shared/candidate-limit";
import { candidateLabel, type MeetingInfo } from "../shared/meeting-info";
import {
  type MeetingInfoApi,
  MeetingInfoFields,
} from "../shared/meeting-info-fields";
import {
  type CalendarCandidate,
  candidateConflicts,
  candidateSlots,
  type ConflictedCandidate,
  CONFLICT_NOTES,
  dayColumnHeading,
  offGridCandidates,
  type Slot,
  SLOT_START_TIMES,
  slotKey,
  slotLabel,
  type SlotState,
} from "./candidate-calendar";
import { newCandidatePreviewItems } from "./candidates-form";
import type { CandidateCalendarApi } from "./use-candidate-calendar";

export function CandidatesPanel({
  candidates,
  meetingInfo,
}: {
  candidates: CandidateCalendarApi;
  meetingInfo: MeetingInfoApi;
}) {
  const durationMinutes = meetingInfo.info.durationMinutes;

  /**
   * 「保存」を押した後か。**押した後に候補日程を触ったら下ろす。**
   *
   * WHY: 永続化も送信APIも無い（#69）ので、完了メッセージが表すのは「この内容で
   * 保存した」という職員の操作だけである。保存後の編集を反映せずに出し続けると、
   * 画面に見えている候補日程と完了メッセージが指すものが食い違う。所要時間の変更も
   * 同じ — 候補日程の長さが全部変わるので、保存した内容ではなくなる。
   */
  const [saved, setSaved] = useState(false);

  const days = candidates.days;
  /*
    描けない候補日程は通常出ない（受け付けの梯子が断る）。日付が変わった後などに
    混ざったら、黙らずに一覧で出して解除させる（`offGridCandidates`）。
  */
  const offGrid =
    days === null ? [] : offGridCandidates(candidates.candidates, days);
  const conflicted = candidateConflicts(candidates.candidates, durationMinutes);
  /*
    上限は入力契約が持つ（`@/lib/contracts/meeting.ts`）。選べてしまうと、超えた瞬間に
    タブ3・タブ4の AI だけが INVALID_INPUT で使えなくなり、画面のどこにも
    「多すぎる」と出ない。
  */
  const limitReason = candidateLimitReason(candidates.candidates.length + 1);

  return (
    /*
      設計書 7.1節はこの画面を max-w-4xl と書いている。他タブ（max-w-3xl）より広いのは
      カレンダーが14列を横に並べるためで、狭めると常に横スクロールになる。
    */
    <div className="mx-auto max-w-4xl">
      <TabHeading>会議作成 STEP3: 候補日程</TabHeading>

      <MeetingInfoFields
        meetingInfo={{
          ...meetingInfo,
          setDurationMinutes: (minutes) => {
            setSaved(false);
            meetingInfo.setDurationMinutes(minutes);
          },
        }}
      />

      <AiAssistant
        taskId={CANDIDATES_TASK_ID}
        /*
          所要時間だけを与件として送る（ADR-0005 の表）。既に選択済みの候補日程は
          送らない — 「来月の午後」→「火曜と木曜だけにして」という書き直しの往復は
          `sessionId` の会話履歴で成立する。
        */
        input={{
          duration_minutes: durationMinutes,
          /*
            表示範囲を渡さないと、AI は「来月の午後」に素直に来月を返す。週送りナビが
            無い（#64 Out of Scope）ので、返ってきた候補日程は1件もカレンダーに置けず、
            職員から見ると生成に成功したのに画面が変わらない。範囲外かどうかを判定
            できるのは暦を解決する AI の側だけなので、与件として渡して聞き返させる。
          */
          calendar_start: days?.[0] ?? "",
          calendar_end: days?.[days.length - 1] ?? "",
        }}
        /*
          送れない画面状態では押させない。上限に達していると返ってきた候補日程が全部
          見送りになり、表示範囲が決まる前は入力契約を満たさない（空の日付）ので
          BFF の門が INVALID_INPUT で弾く。どちらも職員から見ると自分の書いた自然文が
          悪かったように読める。
        */
        submitBlockedReason={
          days === null
            ? "カレンダーの日付を読み込んでいます。少し待つと AI に渡せます。"
            : limitReason
        }
        nonAiPathHint="AI を使わなくても、カレンダーの升目をクリックすれば候補日程を選べます。"
        description={
          "自然な言葉で候補日程を入力すると、AIが自動的にカレンダーに反映します。\n" +
          "例: 「来月の午後、できれば火曜か木曜」「10月第2週の14時から」"
        }
        placeholder="候補日程を自然な言葉で入力してください..."
        followUpPlaceholder="火曜と木曜だけにしてください"
        submitLabel="AIで候補日程を生成"
        pendingLabel="生成中..."
        generatingMessage="AIが候補日程を生成しています..."
        /* 設計書 3.6.5節の文言。カレンダーが画面に入ったので名乗れる。 */
        applyLabel="カレンダーに反映"
        emptyItemText="（生成できませんでした）"
        /*
          プレビューは**いまの選択**を見て組む。加算で入らない候補日程（既に選んだ
          ものと重なる分・上限を超える分）に錠が付くのは、反映と同じ判断を引いて
          いるからである（`candidates-form.ts`）。
        */
        previewItems={(result) =>
          newCandidatePreviewItems(candidates.candidates, result.candidates, {
            durationMinutes,
            days: days ?? [],
          })
        }
        onApply={(result) => {
          setSaved(false);
          return candidates.applyResult(result);
        }}
        onReset={() => {
          setSaved(false);
          candidates.reset();
        }}
      />

      <ManualInputDivider label="または、カレンダーで直接選択" />

      <FormSection taskId={CANDIDATES_TASK_ID}>
        {conflicted.length > 0 && (
          <ConflictNotice
            conflicted={conflicted}
            durationMinutes={durationMinutes}
          />
        )}

        {days === null ? (
          <p className="text-dns-14N-130 text-solid-gray-700">
            カレンダーの日付を読み込んでいます...
          </p>
        ) : (
          <CandidateCalendar
            days={days}
            candidates={candidates.candidates}
            durationMinutes={durationMinutes}
            onToggle={(slot) => {
              setSaved(false);
              candidates.toggleSlot(slot);
            }}
          />
        )}

        {/*
          クリックを受け付けなかった理由（設計書に無い。#69 の設計判断）。**黙って
          無視しない** — 効かない升目があるように見えるだけで、なぜかは画面のどこにも
          出ない。赤にしないのは、もう一度押しても同じという類の失敗ではないため。
        */}
        {candidates.rejected !== null && (
          <p
            role="status"
            className="mt-3 flex items-center gap-2 rounded-md border-l-4 border-solid-yellow-700 bg-solid-yellow-50 p-3 text-dns-14N-130 text-solid-gray-900"
          >
            <AlertCircle
              aria-hidden="true"
              className="size-5 shrink-0 text-solid-yellow-800"
            />
            {candidates.rejected}
          </p>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-4">
          {/* 設計書 2.1節の「選択済み 4件」。反映で何件増えたかはここで分かる。 */}
          <p role="status" className="text-dns-14M-130 text-solid-gray-900">
            選択済み {candidates.candidates.length}件
          </p>
          <button
            type="button"
            onClick={() => {
              setSaved(false);
              candidates.clearAll();
            }}
            disabled={candidates.candidates.length === 0}
            className="rounded-md border border-solid-gray-600 bg-white px-3 py-1.5 text-dns-12M-130 text-solid-gray-900 disabled:opacity-40"
          >
            すべて解除
          </button>
          {/*
            設計書 5.2節の案B（緑のボーダー）を採ったので、色だけが手掛かりになる。
            凡例を添え、読み上げには `slotLabel` が語で言う。
          */}
          <p className="flex items-center gap-2 text-dns-12N-130 text-solid-gray-700">
            <span
              aria-hidden="true"
              className="inline-block size-4 border-2 border-solid-green-500 bg-solid-blue-500"
            />
            AI が選んだ候補日程
          </p>
        </div>

        {limitReason !== null && (
          <p className="mt-1 text-dns-12N-130 text-solid-gray-600">
            {limitReason}
          </p>
        )}

        {offGrid.length > 0 && (
          <OffGridNotice
            candidates={offGrid}
            durationMinutes={durationMinutes}
            onRemove={(id) => {
              setSaved(false);
              candidates.removeCandidate(id);
            }}
          />
        )}

        <div className="mt-8">
          <button
            type="button"
            onClick={() => setSaved(true)}
            disabled={candidates.candidates.length === 0}
            className="rounded-md bg-solid-blue-700 px-4 py-2 text-dns-16M-130 text-white disabled:opacity-40"
          >
            保存
          </button>
          {saved && (
            <p
              role="status"
              className="mt-3 border-l-4 border-solid-blue-700 bg-solid-blue-50 p-3 text-dns-14N-130 text-solid-gray-900"
            >
              候補日程 {candidates.candidates.length}
              件を保存しました。この検証環境では保存されないので、画面を読み込み直すと
              消えます。
            </p>
          )}
        </div>
      </FormSection>
    </div>
  );
}

/**
 * 2週間 × 9:00–18:00 の30分カレンダー（設計書 2.1節）。
 *
 * **升目は表示単位であって選択単位ではない**（`CONTEXT.md`「スロット」）。1クリックが
 * 所要時間ぶんを占める1件の候補日程になる。週送りナビゲーション・早朝表示／夜間表示・
 * 矩形範囲選択は作らない（#64 Out of Scope）。
 *
 * `role="grid"` を書かないのは設計書 8.2節からの意図的なずれである。grid を名乗ると
 * 矢印キーでの移動を支援技術に約束することになるが、中身は素のボタンで Tab で辿る。
 * 名乗らなければ表として読まれ、行見出し（時刻）と列見出し（日付）から升目の位置が
 * そのまま読み上げられる。
 */
function CandidateCalendar({
  days,
  candidates,
  durationMinutes,
  onToggle,
}: {
  days: readonly string[];
  candidates: readonly CalendarCandidate[];
  durationMinutes: MeetingInfo["durationMinutes"];
  onToggle: (slot: Slot) => void;
}) {
  /*
    被覆は描画のたびに導き直す。集合として抱えると、所要時間を変えたときに塗りだけが
    古い長さのまま残る（候補日程は終了時刻を持たない。ADR-0005）。
  */
  const slots = candidateSlots(candidates, durationMinutes);

  return (
    /* 設計書 7.2節・7.3節: 狭い画面では横スクロールで見せる。 */
    <div className="overflow-x-auto">
      <table className="w-full min-w-3xl table-fixed border-collapse">
        <caption className="mb-2 text-left text-dns-14N-130 text-solid-gray-700">
          升目を1回押すと、所要時間（{durationMinutes}
          分）ぶんが1件の候補日程になります。押し直すと解除されます。
        </caption>
        <thead>
          <tr>
            <th
              scope="col"
              className="w-14 border border-solid-gray-300 bg-solid-gray-50 p-1 text-dns-12M-130 text-solid-gray-700"
            >
              時刻
            </th>
            {days.map((day) => (
              <th
                key={day}
                scope="col"
                className="border border-solid-gray-300 bg-solid-gray-50 p-1 text-dns-12M-130 text-solid-gray-700"
              >
                {dayColumnHeading(day)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {SLOT_START_TIMES.map((time) => (
            <tr key={time}>
              <th
                scope="row"
                className="border border-solid-gray-300 bg-solid-gray-50 p-1 text-dns-12N-130 text-solid-gray-700"
              >
                {time}
              </th>
              {days.map((day) => {
                const slot = { date: day, start_time: time };
                const state = slots.get(slotKey(slot));
                return (
                  <td key={day} className="border border-solid-gray-300 p-0">
                    <button
                      type="button"
                      /*
                        選択そのものは `aria-pressed` が言う。AI が選んだことだけを
                        `slotLabel` が語で足す（設計書 8.3節）。
                      */
                      aria-pressed={state !== undefined}
                      aria-label={slotLabel(slot, state)}
                      onClick={() => onToggle(slot)}
                      className={slotClassName(state)}
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * 升目の見た目（設計書 5.2節）。
 *
 * 手で選んだ升目と AI が選んだ升目は**どちらも青で塗る**。違うのは緑のボーダーだけ
 * （案B）で、角バッジ（案A）を採らなかったのは30分の升目にバッジを置くと時刻が
 * 読めなくなるためでもある。
 */
function slotClassName(state: SlotState | undefined): string {
  const base =
    "block h-6 w-full box-border focus:outline-none focus:ring-2 focus:ring-inset focus:ring-solid-blue-700";
  if (state === undefined) {
    return `${base} bg-white hover:bg-solid-blue-100`;
  }
  if (state.source !== "ai") {
    return `${base} bg-solid-blue-500`;
  }

  // 候補日程1件を1つの枠に見せる。中で線が入らないよう、上下は端の升目だけが持つ。
  return [
    base,
    "bg-solid-blue-500 border-x-2 border-solid-green-500",
    state.isStart ? "border-t-2" : "",
    state.isEnd ? "border-b-2" : "",
  ]
    .filter((token) => token !== "")
    .join(" ");
}

/**
 * 所要時間を伸ばした後に残る不整合（#69 の設計判断）。
 *
 * WHY 出すか: 伸縮は導出なので、所要時間を長くすると職員が選んだ候補日程が互いに
 * 重なるか業務時間を越える。**クリックでは作れない状態**が画面に残るので、黙って
 * いると重なった升目を押したときにどちらが消えるのかも説明できない。自動で解除
 * しないのは、職員が選んだ候補日程が操作なしで消えるのを避けるため。
 */
function ConflictNotice({
  conflicted,
  durationMinutes,
}: {
  conflicted: readonly ConflictedCandidate[];
  durationMinutes: MeetingInfo["durationMinutes"];
}) {
  return (
    <div
      role="status"
      className="mb-6 rounded-md border-l-4 border-solid-yellow-700 bg-solid-yellow-50 p-3"
    >
      <p className="flex items-center gap-2 text-dns-14M-130 text-solid-yellow-900">
        <AlertCircle
          aria-hidden="true"
          className="size-5 shrink-0 text-solid-yellow-800"
        />
        所要時間（{durationMinutes}分）では収まらない候補日程が{" "}
        {conflicted.length}件あります。
      </p>
      <ul className="mt-2 list-disc pl-5 text-dns-14N-130 text-solid-gray-900">
        {conflicted.map(({ candidate, conflict }) => (
          <li key={candidate.id}>
            {candidateLabel(candidate, durationMinutes)} —{" "}
            <span className="text-solid-gray-700">
              {CONFLICT_NOTES[conflict]}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-dns-14N-130 text-solid-gray-700">
        升目を押して解除するか、会議情報の所要時間を戻してください。
      </p>
    </div>
  );
}

/**
 * カレンダーに描けない候補日程（#69 の設計判断）。
 *
 * WHY 出すか: 受け付けの梯子（`slotRejection`）が描けない日時を断るので、通常は
 * 1件も出ない。残っている経路は日付が動いたときで、起点は開いたときの「今日」に
 * 固定される一方、選んだ候補日程はそのまま残る。**画面のどこにも現れないまま選択済み
 * 件数だけが増える**状態を黙らないための最後の網である。
 */
function OffGridNotice({
  candidates,
  durationMinutes,
  onRemove,
}: {
  candidates: readonly CalendarCandidate[];
  durationMinutes: MeetingInfo["durationMinutes"];
  onRemove: (id: string) => void;
}) {
  return (
    <div
      role="status"
      className="mt-6 rounded-md border-l-4 border-solid-yellow-700 bg-solid-yellow-50 p-3"
    >
      <p className="flex items-center gap-2 text-dns-14M-130 text-solid-yellow-900">
        <Info
          aria-hidden="true"
          className="size-5 shrink-0 text-solid-yellow-800"
        />
        カレンダーに描けない候補日程が {candidates.length}件あります。
      </p>
      <p className="mt-1 text-dns-12N-130 text-solid-gray-700">
        表示範囲の外、または 9:00–18:00
        の30分刻みに載らない日時です。カレンダーの升目では解除できないので、ここから
        解除してください。
      </p>
      <ul className="mt-2 grid gap-1 text-dns-14N-130 text-solid-gray-900">
        {candidates.map((candidate) => (
          <li key={candidate.id} className="flex items-center gap-2">
            {candidateLabel(candidate, durationMinutes)}
            {candidate.source === "ai" && (
              <span className="text-dns-12N-130 text-solid-green-900">
                AIが選択
              </span>
            )}
            <button
              type="button"
              onClick={() => onRemove(candidate.id)}
              className="text-dns-12N-130 text-solid-gray-600 underline underline-offset-2"
            >
              解除
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
