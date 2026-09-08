/**
 * taskId ごとの Skill の instructions（ADR-0012・ADR-0013）。手書きの表 —
 * 生成もドリフト検知テストも無い。中身が唯一の実体（`skills/{domain}/{task}.ts`）
 * を直接 import しているため、2箇所が食い違う余地自体が無い。
 *
 * キーを `TaskId` にしてあるので、taskId を足したときの登録漏れが型エラーになる。
 * ドメインでネストしていたのは `AgentSkills` に1ドメイン分をまとめて渡すためで、
 * `explicit` に畳んだ（ADR-0013）今はその読者がいない。
 */

import type { TaskId } from '../contracts/index.js';
import icCardParseReservation from './ic-card/parse-reservation.js';
import meetingParseAvailability from './meeting/parse-availability.js';
import meetingParseCandidates from './meeting/parse-candidates.js';
import meetingRecommendSchedule from './meeting/recommend-schedule.js';

export const SKILLS: Record<TaskId, string> = {
  'ic-card.parse-reservation': icCardParseReservation,
  'meeting.parse-candidates': meetingParseCandidates,
  'meeting.parse-availability': meetingParseAvailability,
  'meeting.recommend-schedule': meetingRecommendSchedule,
};
