"use client";

import { useState } from "react";
import { CandidatesPanel } from "./candidates-panel";
import { ReservationPanel } from "./reservation-panel";

/**
 * タブの定義。参加可否タブは別チケットでここに1行増える。
 *
 * WHY: タブの切り替えでフォームの状態を持ち越さない（`key` を渡して作り直す）。
 * タブごとに状態モデルが違うので持ち越す先が無く、AI チャット欄も前のタブの
 * 応答を残したままにすると、どの taskId の結果を見ているのか分からなくなる。
 */
const TABS = [
  { id: "ic-card", label: "交通IC予約", Panel: ReservationPanel },
  { id: "meeting-candidates", label: "会議候補日設定", Panel: CandidatesPanel },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function FormEchoTabs() {
  const [activeTabId, setActiveTabId] = useState<TabId>(TABS[0].id);
  const active = TABS.find((tab) => tab.id === activeTabId) ?? TABS[0];

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

      <active.Panel key={active.id} />
    </>
  );
}
