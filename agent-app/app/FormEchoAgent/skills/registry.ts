/**
 * taskId ごとの Skill データ（ADR-0012）。手書きの表 — 生成もドリフト検知テストも無い。
 * 中身が唯一の実体（`skills/{domain}/{task}.ts`）を直接 import しているため、
 * 2箇所が食い違う余地自体が無い。
 */

import type { SkillConfig } from '@strands-agents/sdk/vended-plugins/skills';
import icCardParseReservation from './ic-card/parse-reservation.js';
import meetingParseAvailability from './meeting/parse-availability.js';
import meetingParseCandidates from './meeting/parse-candidates.js';
import meetingRecommendSchedule from './meeting/recommend-schedule.js';

export const SKILLS: Record<string, Record<string, SkillConfig>> = {
  'ic-card': {
    'parse-reservation': icCardParseReservation,
  },
  meeting: {
    'parse-availability': meetingParseAvailability,
    'parse-candidates': meetingParseCandidates,
    'recommend-schedule': meetingRecommendSchedule,
  },
};
