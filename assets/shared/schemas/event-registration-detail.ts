import { z } from "zod";
import { eventIdSchema, successResponseSchema, trimmedString } from "./api-common";
import { activeFormSummarySchema } from "./forms";
import { databaseIdSchema } from "./identifiers";
import { registrationRecordContextSchema } from "./registration-record";
import {
  attendanceTypeSchema,
  dayAttendanceTypeSchema,
  dayDateSchema,
  dayWaitlistItemSchema,
  registrationDayAttendanceResponseItemSchema,
} from "./registration";
import { eventDayResponseSchema } from "./event-configuration";
import { sourceTypeSchema } from "./source";

/** RSVP state attached to a registration's most recent response for each day. */
export const eventRegistrationRsvpDaySchema = z.object({
  event_day_id: databaseIdSchema.nullable(),
  day_date: z.string().nullable(),
  status: z.string(),
  received_at: z.string(),
  ics_uid: z.string(),
  action_taken: z.string().nullable(),
});

/** Full registration projection retained for the legacy administrator adapter. */
export const eventRegistrationDetailSchema = registrationRecordContextSchema.extend({
  id: databaseIdSchema,
  event_id: eventIdSchema,
  user_id: databaseIdSchema,
  status: z.string(),
  cancellation_reason_code: z.string().nullable(),
  attendance_type: attendanceTypeSchema,
  source_type: sourceTypeSchema,
  rsvp_status: z.string().nullable(),
  rsvpByDay: z.array(eventRegistrationRsvpDaySchema),
  customAnswers: z.record(z.string(), z.unknown()).nullable(),
});

/**
 * Minimal projection for group attendance managers. It deliberately excludes
 * form answers, referral data, and other administrator-only details.
 */
export const eventRegistrationAttendanceDetailSchema = registrationRecordContextSchema
  .pick({ created_at: true, updated_at: true, user_email: true, display_name: true })
  .extend({
    id: databaseIdSchema,
    event_id: eventIdSchema,
    user_id: databaseIdSchema,
    status: z.string(),
    attendance_type: attendanceTypeSchema,
    source_type: sourceTypeSchema,
  });

export const eventRegistrationDayAttendanceSchema = registrationDayAttendanceResponseItemSchema;
export const eventRegistrationDayWaitlistSchema = dayWaitlistItemSchema;

export const eventRegistrationDetailResponseSchema = z.object({
  registration: eventRegistrationDetailSchema,
  form: activeFormSummarySchema.nullable(),
  dayAttendance: z.array(eventRegistrationDayAttendanceSchema),
  dayWaitlist: z.array(eventRegistrationDayWaitlistSchema),
});

export const eventRegistrationAttendanceDetailResponseSchema = z.object({
  registration: eventRegistrationAttendanceDetailSchema,
  dayAttendance: z.array(eventRegistrationDayAttendanceSchema),
  dayWaitlist: z.array(eventRegistrationDayWaitlistSchema),
  eventDays: z.array(eventDayResponseSchema),
});

export const eventRegistrationDayAttendanceChangeSchema = z.object({
  action: z.union([dayAttendanceTypeSchema, z.enum(["remove", "waitlist"])]),
  dayDates: z.array(dayDateSchema).min(1).max(31),
});

export const eventRegistrationDayAttendanceResponseSchema = successResponseSchema;

export const eventRegistrationAdmitResponseSchema = successResponseSchema.extend({
  registration: eventRegistrationAttendanceDetailSchema,
  admittedDayDates: z.array(dayDateSchema),
});

export const eventRegistrationAdmitSchema = z.object({
  mode: z.enum(["vip", "capacity_exempt"]).default("vip"),
  reason: trimmedString(3, 1000),
  dayDates: z.array(dayDateSchema).min(1).max(31).optional(),
});

/** Group managers must explicitly select both the admission mode and event days. */
export const eventRegistrationSelectedDayAdmitSchema = eventRegistrationAdmitSchema.extend({
  mode: z.enum(["vip", "capacity_exempt"]),
  dayDates: z.array(dayDateSchema).min(1).max(31),
});

export type EventRegistrationDetailResponse = z.infer<typeof eventRegistrationDetailResponseSchema>;
export type EventRegistrationAttendanceDetailResponse = z.infer<typeof eventRegistrationAttendanceDetailResponseSchema>;
export type EventRegistrationDayAttendanceChange = z.infer<typeof eventRegistrationDayAttendanceChangeSchema>;
export type EventRegistrationAdmitInput = z.infer<typeof eventRegistrationAdmitSchema>;
export type EventRegistrationSelectedDayAdmitInput = z.infer<typeof eventRegistrationSelectedDayAdmitSchema>;
