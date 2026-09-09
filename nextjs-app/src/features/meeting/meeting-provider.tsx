"use client";

import { createContext, type ReactNode, useContext } from "react";
import {
  type CandidateCalendarApi,
  useCandidateCalendar,
} from "./candidates/use-candidate-calendar";
import {
  type MeetingInfoApi,
  useMeetingInfo,
} from "./shared/meeting-info-fields";

/** 会議ロジの3画面（候補日設定・参加可否回答・候補日提案）が跨いで読む状態。 */
type MeetingApi = {
  meetingInfo: MeetingInfoApi;
  /** 候補日程そのものではなくカレンダーの API（候補日程は `.candidates`）。 */
  candidates: CandidateCalendarApi;
};

/*
  既定値を置かず `null` から始める。置くと Provider の外で呼んでも動いてしまい、
  「入力が消える」という形で実行時にしか気付けない（3画面が別々の状態を持つ）。
*/
const MeetingContext = createContext<MeetingApi | null>(null);

/**
 * WHY 会議 feature が出すか: 実体はタブを並べるルート層（`form-echo-tabs.tsx`）が
 * 持っていた。どの画面も相手から見えないので、共通の祖先まで上げるしかなかったため
 * である。上げ先がルート層だと「Next.js のルーティングの話」であるはずの層が会議の
 * 状態モデルを握り、画面を1つ足すたびにルート層が配る prop が増える（ADR-0016）。
 * 状態を要るのは会議 feature の内側だけなので、置き場所も feature の中に閉じる。
 *
 * **持ち上がったのは置き場所だけ。** 状態モデルと遷移は元のまま
 * （`shared/meeting-info-fields.tsx` の `useMeetingInfo` と
 * `candidates/use-candidate-calendar.ts` の `useCandidateCalendar`）で、この Provider は
 * 2つを同じ木の同じ位置で呼ぶだけである。
 */
export function MeetingProvider({ children }: { children: ReactNode }) {
  const meetingInfo = useMeetingInfo();
  /*
    所要時間を渡すのは、カレンダーのクリックの受け付け（重なり・業務時間への収まり）が
    所要時間抜きには決まらないため。だから会議情報より後に呼ぶ。カレンダーが見せる
    14日はこのフックが自分で決める（起点は職員の「今日」で、SSG のためブラウザ側でしか
    決まらない）。
  */
  const candidates = useCandidateCalendar(meetingInfo.info.durationMinutes);

  return (
    <MeetingContext value={{ meetingInfo, candidates }}>
      {children}
    </MeetingContext>
  );
}

export function useMeeting(): MeetingApi {
  const meeting = useContext(MeetingContext);
  if (meeting === null) {
    throw new Error("useMeeting は MeetingProvider の内側でしか呼べません。");
  }
  return meeting;
}
