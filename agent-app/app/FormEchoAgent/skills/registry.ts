/**
 * taskId ごとの Skill の instructions（ADR-0012・ADR-0013）。手書きの表 —
 * 生成もドリフト検知テストも無い。中身が唯一の実体（`skills/{domain}/{task}.ts`）
 * を直接 import しているため、2箇所が食い違う余地自体が無い。
 *
 * キーを `TaskId` にしてあるので、taskId を足したときの登録漏れが型エラーになる。
 * **`playground.free-prompt` だけを除く**（ADR-0020）— あの taskId の system prompt は
 * 職員が持ち込む文そのもので、Skill を足した瞬間に職員が見ているのが「自分が書いた文の
 * 効き」ではなくなる。除外を型で書くので、**他4タブの登録漏れは引き続き型エラーになる。**
 * ドメインでネストしていたのは `AgentSkills` に1ドメイン分をまとめて渡すためで、
 * `explicit` に畳んだ（ADR-0013）今はその読者がいない。
 */

import type { FREE_PROMPT_TASK_ID, TaskId } from '../contracts/index.js';
import icCardParseReservation from './ic-card/parse-reservation.js';
import meetingParseAvailability from './meeting/parse-availability.js';
import meetingParseCandidates from './meeting/parse-candidates.js';
import meetingRecommendSchedule from './meeting/recommend-schedule.js';

export const SKILLS: Record<
  Exclude<TaskId, typeof FREE_PROMPT_TASK_ID>,
  string
> = {
  'ic-card.parse-reservation': icCardParseReservation,
  'meeting.parse-candidates': meetingParseCandidates,
  'meeting.parse-availability': meetingParseAvailability,
  'meeting.recommend-schedule': meetingRecommendSchedule,
};
