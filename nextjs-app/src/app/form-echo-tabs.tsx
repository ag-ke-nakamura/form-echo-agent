"use client";

import { type ReactNode, useState } from "react";
import { AvailabilityPanel } from "@/features/meeting/availability/availability-panel";
import { CandidatesPanel } from "@/features/meeting/candidates/candidates-panel";
import { MeetingProvider } from "@/features/meeting/meeting-provider";
import { RecommendPanel } from "@/features/meeting/recommend/recommend-panel";
import { ReservationPanel } from "@/features/ic-card/reservation-panel";

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

/**
 * ここが持つのはタブの並びと「いまどれが選ばれているか」だけである。会議の共有状態
 * （会議情報・候補日程）は会議 feature の `MeetingProvider` が持ち、各パネルが
 * `useMeeting` で読む — ルート層は prop として配らない（ADR-0016 / #159）。
 */
export function FormEchoTabs() {
  const [activeTabId, setActiveTabId] = useState<TabId>(TABS[0].id);

  const panels: Record<TabId, ReactNode> = {
    "ic-card": <ReservationPanel />,
    "meeting-candidates": <CandidatesPanel />,
    "meeting-availability": <AvailabilityPanel />,
    /*
      候補日提案タブにだけ `active` を渡す。**AI 推論をタブが開かれた時に1回だけ
      走らせる**ため（設計書 10.1節）で、全タブが描かれたままなのでマウントでは
      代われない。会議の共有状態と違い、これはタブ層しか知らないことである。
    */
    "meeting-recommend": (
      <RecommendPanel active={activeTabId === "meeting-recommend"} />
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
      <MeetingProvider>
        {TABS.map((tab) => (
          <div key={tab.id} hidden={tab.id !== activeTabId}>
            {panels[tab.id]}
          </div>
        ))}
      </MeetingProvider>
    </>
  );
}
