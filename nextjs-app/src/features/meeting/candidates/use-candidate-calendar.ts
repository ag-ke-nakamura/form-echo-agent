"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import type { ApplyReport } from "@/components/ai-assistant/field-source";
import { candidateIdOf } from "@/lib/contracts/meeting";
import type { ParseCandidatesOutput } from "@/lib/contracts/types";
import type { MeetingInfo } from "../shared/meeting-info";
import {
  addCandidateAt,
  type CalendarCandidate,
  type CalendarContext,
  calendarDays,
  candidateSlots,
  isoDateOf,
  type Slot,
  slotKey,
} from "./candidate-calendar";
import { applyAiCandidates } from "./candidates-form";

/**
 * 候補日程タブの状態を外から持てるようにしたもの。
 *
 * WHY: 参加可否タブが答える対象は、このタブが持っている候補日程である。どちらかの
 * タブの内側に状態を置くと相手から見えないので、状態の持ち主を `FormEchoTabs` に上げる。
 *
 * **状態モデル（`CalendarCandidate`）は `candidate-calendar.ts` にある**（#69）。行のフォームだった
 * 頃はタブのファイルに置いていたが、カレンダーになった今は純関数がすべてその形を受けて
 * 返すので、タブ側に置くと純関数の側から掘りに行くことになる。
 *
 * 文脈（所要時間とカレンダーの表示範囲）を受け取るのは、クリックの受け付けと AI の
 * 反映がその2つ抜きには決まらないため。**候補日程は終了時刻を持たない**（ADR-0005）し、
 * 職員が選べる日付は表示範囲の中にしか無い（#69）。
 */
export type CandidateCalendarApi = {
  candidates: CalendarCandidate[];
  /**
   * カレンダーが見せている14日。**ブラウザで描くときだけ決まる**（`null` は未確定）。
   *
   * 職員が選べる日付でもあり、AI へ与件として渡す表示範囲でもある（ADR-0005 の表）。
   */
  days: string[] | null;
  /** 升目のクリック。空いていれば候補日程にし、埋まっていればその候補日程を解除する。 */
  toggleSlot: (slot: Slot) => void;
  /** 識別子で解除する。カレンダーに描けない候補日程の一覧が引く。 */
  removeCandidate: (id: string) => void;
  /** 「すべて解除」（設計書 5.4節）。AI が選んだ分も手で選んだ分も落とす。 */
  clearAll: () => void;
  applyResult: (result: ParseCandidatesOutput) => ApplyReport;
  reset: () => void;
  /** 直近のクリックを受け付けなかった理由。受け付けたら `null` に戻る。 */
  rejected: string | null;
};

/**
 * 起点の日付は時計を読むだけで、変わったことを知らせる相手がいない（週送りナビも
 * 無い）。購読の解除だけを返す。
 */
function subscribeToNothing(): () => void {
  return () => {};
}

export function useCandidateCalendar(
  durationMinutes: MeetingInfo["durationMinutes"],
): CandidateCalendarApi {
  /**
   * カレンダーの起点。**ブラウザで描くときだけ決まる。**
   *
   * WHY こう取るか: 起点は職員が見ている「今日」だが、SSG なのでビルド時に描いた
   * HTML とブラウザの初回描画が食い違ってはならない（ビルド機の「今日」は職員の
   * 「今日」ではない）。`useSyncExternalStore` はサーバー側の値（`null`）と
   * ブラウザ側の値を別に取れるので、React が食い違いを起こさずに描き直す。
   *
   * 返すのは日付の**文字列**である。ここで配列を作ると呼ばれるたびに別物になり、
   * React が「snapshot が安定していない」と見て描き直し続ける。
   */
  const today = useSyncExternalStore(
    subscribeToNothing,
    () => isoDateOf(new Date()),
    () => null,
  );
  const days = today === null ? null : calendarDays(today);
  /*
    起点が決まる前は空の範囲を渡す。受け付けの梯子（`slotRejection`）がそれを
    「表示範囲が決まっていません」として断るので、決まる前のクリックが素通りしない。
  */
  const context: CalendarContext = { durationMinutes, days: days ?? [] };
  /**
   * 選択済みの候補日程。**初期は空**。
   *
   * 行のフォームだった頃は空の1行から始めていた（手で埋めきる起点として）。カレンダーは
   * 升目そのものが起点なので、空の候補日程を置く必要が無い。SSG で問題になる初期値
   * （乱数・連番・時計）も持たない。
   */
  const [candidates, setCandidates] = useState<CalendarCandidate[]>([]);
  const [rejected, setRejected] = useState<string | null>(null);
  const nextSequence = useRef(0);

  /**
   * 升目のクリック。**1クリックが候補日程1件**（#69）。
   *
   * 埋まっている升目を押すと、その升目を持っている候補日程が解除される。所要時間を
   * 伸ばして重なった場合、升目を持つのは後から始まる側（`candidateSlots`）で、
   * 押したときに消えるのもそれである。
   */
  function toggleSlot(slot: Slot) {
    const occupied = candidateSlots(candidates, context.durationMinutes).get(
      slotKey(slot),
    );
    if (occupied !== undefined) {
      setRejected(null);
      setCandidates((current) =>
        current.filter((candidate) => candidate.id !== occupied.candidateId),
      );
      return;
    }

    /*
      識別子は受け付けられたときだけ進める。受け付けられないクリック（重なり・業務
      時間・上限）で番号を飛ばすと、飛んだ理由が後から誰にも読めない。
    */
    const added = addCandidateAt(
      candidates,
      slot,
      context,
      candidateIdOf(nextSequence.current),
    );
    setRejected(added.rejected);
    if (added.rejected !== null) return;
    nextSequence.current += 1;
    setCandidates(added.candidates);
  }

  function removeCandidate(id: string) {
    setRejected(null);
    setCandidates((current) =>
      current.filter((candidate) => candidate.id !== id),
    );
  }

  /**
   * AI の結果をカレンダーへ反映する。**加算**（設計書 5.1節）で、判断は
   * `applyAiCandidates` が持つ（重なるものを見送る・件数の上限）。
   *
   * 判断を setState の updater の中に置けないのは、何を反映して何を見送ったかを
   * **同期で**返す必要があるため（updater は純粋に保つ約束があり、実行も後になる）。
   */
  function applyResult(result: ParseCandidatesOutput): ApplyReport {
    const applied = applyAiCandidates(
      candidates,
      result,
      context,
      nextSequence.current,
    );
    // 反映した分だけ番号が進む（`applyAiCandidates` が返す）。見送った候補日程で
    // 飛ばさないのは、クリックを断ったときと同じ約束である。
    nextSequence.current = applied.nextSequence;
    setRejected(null);
    setCandidates(applied.candidates);
    return applied.report;
  }

  /**
   * 識別子の採番は戻さない。戻すと、解除の直後に選んだ候補日程が消えた候補日程と
   * 同じ識別子を持ちうる（参加可否タブとタブ4の突き合わせが壊れる）。
   */
  function clearAll() {
    setRejected(null);
    setCandidates([]);
  }

  return {
    candidates,
    days,
    toggleSlot,
    removeCandidate,
    clearAll,
    applyResult,
    // 「最初からやり直す」でやることは「すべて解除」と同じ。会話の側は
    // `AiAssistant` が畳む。
    reset: clearAll,
    rejected,
  };
}
