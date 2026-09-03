"use client";

import { useState } from "react";
import { CandidatesPanel } from "./candidates-panel";
import { ReservationPanel } from "./reservation-panel";

/** タブの定義。参加可否タブは別チケットでここに1行増える。 */
const TABS = [
  { id: "ic-card", label: "交通IC予約", Panel: ReservationPanel },
  { id: "meeting-candidates", label: "会議候補日設定", Panel: CandidatesPanel },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function FormEchoTabs() {
  const [activeTabId, setActiveTabId] = useState<TabId>(TABS[0].id);

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
          <tab.Panel />
        </div>
      ))}
    </>
  );
}
