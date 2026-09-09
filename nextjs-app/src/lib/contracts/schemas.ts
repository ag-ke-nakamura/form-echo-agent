import { z } from "zod";
import {
  AVAILABILITY_ORDER,
  CANDIDATE_ID_PATTERN,
  DURATION_OPTIONS,
  MAX_INPUT_CANDIDATES,
  MEETING_FORMAT_ORDER,
} from "./meeting";

/**
 * `meeting.recommend-schedule` の入力を検査する Zod スキーマ。#109（ADR-0011）で
 * `contracts/fields.ts` / `contracts/inputs.ts` から、`recommendScheduleInputSchema`
 * （テスト専用: `availability-table.test.ts` が参加可否表のモック生成器を検査する）に
 * 要る範囲だけ複製した。
 *
 * WHY zod を値として import してよいか: `meeting.ts` / `recommendation.ts` /
 * `prompt-requirement.ts` と違い、このファイルを値として引くのはテストだけで、
 * どの画面（`.tsx`）からも引かれない。SSG のバンドルに乗らないので、zod を持ち込んでも
 * `next build` の出力は太らない。
 */

const DATE_BODY = "\\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01])";
const TIME_BODY = "([01]\\d|2[0-3]):[0-5]\\d";

const ISO8601_DATE = new RegExp(`^${DATE_BODY}$`);

function isCalendarDate(value: string): boolean {
  const parsed = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().startsWith(`${value}T`)
  );
}

const isoDateSchema = z
  .string()
  .regex(ISO8601_DATE)
  .refine(isCalendarDate, { error: "暦に存在しない日付です" });

const HH_MM = new RegExp(`^${TIME_BODY}$`);

const timeOfDaySchema = z.string().regex(HH_MM);

const candidateIdSchema = z.string().regex(CANDIDATE_ID_PATTERN);

const candidateFieldsSchema = z.object({
  id: candidateIdSchema,
  date: isoDateSchema,
  start_time: timeOfDaySchema,
});

const durationMinutesSchema = z.literal(DURATION_OPTIONS);

const meetingFormatSchema = z.enum(MEETING_FORMAT_ORDER);

const availabilitySchema = z.enum(AVAILABILITY_ORDER);

const PARTICIPANT = /^参加者[A-Z]$/;

const participantSchema = z.string().regex(PARTICIPANT);

const answerSchema = z.object({
  participant: participantSchema,
  availability: availabilitySchema,
});

const candidateWithAnswersSchema = candidateFieldsSchema.extend({
  answers: z.array(answerSchema),
});

export const recommendScheduleInputSchema = z.object({
  meeting_format: meetingFormatSchema,
  duration_minutes: durationMinutesSchema,
  participants: z.array(participantSchema).min(1),
  candidates: z
    .array(candidateWithAnswersSchema)
    .min(1)
    .max(MAX_INPUT_CANDIDATES),
});
