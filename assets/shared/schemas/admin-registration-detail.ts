import { z } from "zod";
import { eventIdSchema } from "./api-common";
import { activeFormSummarySchema } from "./forms";
import { databaseIdSchema } from "./identifiers";

/** Joined display, attribution, and lifecycle fields common to admin registration projections. */
export const adminRegistrationRecordContextSchema = z.object({
  created_at: z.string(),
  updated_at: z.string(),
  user_email: z.string().nullable(),
  display_name: z.string().nullable(),
  referral_code: z.string().nullable(),
});

export const adminRegistrationRsvpDaySchema = z.object({
  event_day_id: databaseIdSchema.nullable(),
  day_date: z.string().nullable(),
  status: z.string(),
  received_at: z.string(),
  ics_uid: z.string(),
  action_taken: z.string().nullable(),
});

export const adminRegistrationDetailSchema = adminRegistrationRecordContextSchema.extend({
  id: databaseIdSchema,
  event_id: eventIdSchema,
  user_id: databaseIdSchema,
  status: z.string(),
  cancellation_reason_code: z.string().nullable(),
  attendance_type: z.string(),
  source_type: z.string(),
  rsvp_status: z.string().nullable(),
  rsvpByDay: z.array(adminRegistrationRsvpDaySchema),
  customAnswers: z.record(z.string(), z.unknown()).nullable(),
});

export const adminRegistrationDayAttendanceSchema = z.object({
  dayDate: z.string(),
  attendanceType: z.string(),
  label: z.string().nullable(),
});

export const adminRegistrationDayWaitlistSchema = z.object({
  dayDate: z.string(),
  status: z.string(),
  priorityLane: z.string(),
  offerExpiresAt: z.string().nullable(),
});

export const adminRegistrationDetailResponseSchema = z.object({
  registration: adminRegistrationDetailSchema,
  form: activeFormSummarySchema.nullable(),
  dayAttendance: z.array(adminRegistrationDayAttendanceSchema),
  dayWaitlist: z.array(adminRegistrationDayWaitlistSchema),
});

export type AdminRegistrationDetailResponse = z.infer<typeof adminRegistrationDetailResponseSchema>;
