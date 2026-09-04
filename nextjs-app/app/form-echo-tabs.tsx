"use client";

import { type ReactNode, useState } from "react";
import { AvailabilityPanel } from "./availability-panel";
import {
  CandidatesPanel,
  selectedCandidates,
  useCandidateCalendar,
} from "./candidates-panel";
import { useMeetingInfo } from "./meeting-info";
import { RecommendPanel } from "./recommend-panel";
import { ReservationPanel } from "./reservation-panel";

/**
 * タブの定義。並び順は職員が触る順（予約 → 候補日程を決める → 可否を答える →
 * 集まった可否から開催日を決める）に合わせる。プロダクトオーナーがタブの切り替え
 * だけで4機能を順に追えるようにする。
 */
const TABS = [
  { id: "ic-card", label: "交通IC予約" },
  { id: "meeting-candidates", label: "会議候補日設定" },
  { id: "meeting-availability", label: "参加可否回答" },
  { id: "meeting-recommend", label: "候補日提案" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function FormEchoTabs() {
  const [activeTabId, setActiveTabId] = useState<TabId>(TABS[0].id);

  /**
   * 会議情報（会議名・所要時間・参加形式）はタブ層で持つ。
   *
   * WHY: 入れるのはタブ2だが、読むのはタブ3のヘッダー（何の会議に答えているのか）
   * とタブ4（参加可否表とともに Runtime へ渡す与件。ADR-0005）である。所要時間は
   * 候補日程の終わる時刻も決めるので、タブ2の表示自体もここから引く。上がったのは
   * 置き場所だけ — 状態モデルの定義は `meeting-info.tsx` に残す。
   */
  const meetingInfo = useMeetingInfo();

  /**
   * 候補日程もタブ層で持つ。
   *
   * WHY: 参加可否タブが可否を付ける対象は候補日程タブが選んだ候補日程であり、AI は
   * 既にある候補日程へ可否を付けるだけで候補日程そのものは作らない。どちらかの
   * タブの内側に置くと相手から見えず、参加可否タブは対象がないまま必ず空振りする。
   * 状態モデルは `app/lib/candidate-calendar.ts` にあり、ここに上がったのは
   * 置き場所だけ（#23: フォームの状態モデルはタブごとに分ける）。
   *
   * 所要時間を渡すのは、カレンダーのクリックの受け付け（重なり・業務時間への収まり）が
   * 所要時間抜きには決まらないため。だから会議情報より後に置く。カレンダーが見せる
   * 14日はこのフックが自分で決める（起点は職員の「今日」で、SSG のためブラウザ側でしか
   * 決まらない）。
   */
  const candidates = useCandidateCalendar(meetingInfo.info.durationMinutes);

  const panels: Record<TabId, ReactNode> = {
    "ic-card": <ReservationPanel />,
    "meeting-candidates": (
      <CandidatesPanel candidates={candidates} meetingInfo={meetingInfo} />
    ),
    "meeting-availability": (
      <AvailabilityPanel
        candidates={selectedCandidates(candidates.candidates)}
        meetingInfo={meetingInfo.info}
      />
    ),
    /*
      候補日程タブ・参加可否タブとは連動しない。参加可否表は自分のモックを持つ
      （#58）。候補日程タブに同じサンプルを焼き込むと、焼いた行が手入力として
      扱われ、AI が候補日程を作り直したときにサンプル行の上へ積み上がる。
      会議情報だけは受け取る — 参加形式と所要時間は Runtime へ渡す与件であり、
      モックの表が持つべきものではない（`lib/availability-table.ts`）。
      このタブだけ `active` を渡す。**AI 推論をタブが開かれた時に1回だけ走らせる**
      ため（設計書 10.1節）で、全タブが描かれたままなのでマウントでは代われない。
    */
    "meeting-recommend": (
      <RecommendPanel
        meetingInfo={meetingInfo.info}
        active={activeTabId === "meeting-recommend"}
      />
    ),
  };

  return (
    <>
      <nav
        aria-label="AI 機能"
        className="mb-8 flex flex-wrap gap-1 border-b border-solid-gray-300"
      >
        {TABS.map((tab) => {
          const selected = tab.id === activeTabId;
          return (
            <button
              key={tab.id}
              type="button"
              aria-current={selected ? "page" : undefined}
              onClick={() => setActiveTabId(tab.id)}
              className={
                selected
                  ? "border-b-2 border-solid-blue-700 px-3 pb-2 text-dns-14M-130 text-solid-blue-900"
                  : "border-b-2 border-transparent px-3 pb-2 text-dns-14N-130 text-solid-gray-600"
              }
            >
              {tab.label}
            </button>
          );
        })}
      </nav>

      {/*
        選んでいないタブも描いたまま隠す。
        タブごとに作り直すと、AI が埋めた値を直している最中（ストーリー3・4）に
        タブを触っただけで入力が消える。`hidden` なので支援技術からも外れる。
      */}
      {TABS.map((tab) => (
        <div key={tab.id} hidden={tab.id !== activeTabId}>
          {panels[tab.id]}
        </div>
      ))}
    </>
  );
}
