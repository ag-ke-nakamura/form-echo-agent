"use client";

import { type ReactNode, useState } from "react";
import { AvailabilityPanel } from "./availability-panel";
import {
  candidateDates,
  CandidatesPanel,
  useCandidateRows,
} from "./candidates-panel";
import { ReservationPanel } from "./reservation-panel";

/**
 * タブの定義。並び順は職員が触る順（予約 → 候補日程を決める → 可否を答える）に
 * 合わせる。プロダクトオーナーがタブの切り替えだけで3機能を順に追えるようにする。
 */
const TABS = [
  { id: "ic-card", label: "交通IC予約" },
  { id: "meeting-candidates", label: "会議候補日設定" },
  { id: "meeting-availability", label: "参加可否回答" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function FormEchoTabs() {
  const [activeTabId, setActiveTabId] = useState<TabId>(TABS[0].id);

  /**
   * 候補日程はタブ層で持つ。
   *
   * WHY: 参加可否タブが○×を付ける対象は候補日程タブが作った日付であり、AI は
   * 既にある候補日程へ○×を付けるだけで候補日程そのものは作らない。どちらかの
   * タブの内側に置くと相手から見えず、参加可否タブは対象がないまま必ず空振りする。
   * 状態モデルの定義は `candidates-panel.tsx` に残してあり、ここに上がったのは
   * 置き場所だけ（#23: フォームの状態モデルはタブごとに分ける）。
   */
  const candidates = useCandidateRows();

  const panels: Record<TabId, ReactNode> = {
    "ic-card": <ReservationPanel />,
    "meeting-candidates": <CandidatesPanel candidates={candidates} />,
    "meeting-availability": (
      <AvailabilityPanel dates={candidateDates(candidates.rows)} />
    ),
  };

  return (
    <>
      <nav
        aria-label="AI 機能"
        className="mb-6 flex gap-1 border-b border-black/10 dark:border-white/15"
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
                  ? "border-b-2 border-foreground px-3 pb-2 text-sm font-medium"
                  : "border-b-2 border-transparent px-3 pb-2 text-sm text-black/55 dark:text-white/55"
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
