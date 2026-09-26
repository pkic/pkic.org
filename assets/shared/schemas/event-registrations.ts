import { z } from "zod";
import { successResponseSchema } from "./api-common";
import { eventSummarySchema } from "./event-read-models";
import { databaseIdSchema } from "./identifiers";
import { paginatedResponseSchema, searchableListQuerySchema, sortColumnSchema } from "./pagination";
import { registrationRecordContextSchema } from "./registration-record";

export const EVENT_REGISTRATIONS_SORT_COLUMNS = ["display_name", "status", "attendance_type", "created_at"] as const;
export const EVENT_REGISTRATION_STATUSES = ["registered", "pending_email_confirmation", "cancelled"] as const;
export const EVENT_REGISTRATION_STATUS_FILTERS = ["all", ...EVENT_REGISTRATION_STATUSES] as const;
export const EVENT_REGISTRATION_STATUS_LABELS: Record<EventRegistrationStatus, string> = {
  pending_email_confirmation: "Pending confirmation",
  registered: "Registered",
  cancelled: "Cancelled",
};
export const eventRegistrationStatusSchema = z.enum(EVENT_REGISTRATION_STATUSES);
export type EventRegistrationStatus = z.infer<typeof eventRegistrationStatusSchema>;
export const eventRegistrationStatusFilterSchema = z.enum(EVENT_REGISTRATION_STATUS_FILTERS);
export type EventRegistrationStatusFilter = z.infer<typeof eventRegistrationStatusFilterSchema>;
export function eventRegistrationStatusLabel(status: EventRegistrationStatus): string {
  return EVENT_REGISTRATION_STATUS_LABELS[status];
}

export const eventRegistrationPromotionsResponseSchema = successResponseSchema.extend({
  dayRegistrationOffers: z.number().int().nonnegative(),
  affectedRegistrations: z.array(databaseIdSchema),
});

export const eventRegistrationAttendanceChangeFilterSchema = z.enum(["any", "left_in_person", "joined_in_person"]);
export type EventRegistrationAttendanceChangeFilter = z.infer<typeof eventRegistrationAttendanceChangeFilterSchema>;

/** The words the attendance-change view is offered under, beside the filter it narrows by. */
export const EVENT_REGISTRATION_ATTENDANCE_CHANGE_LABELS: Record<EventRegistrationAttendanceChangeFilter, string> = {
  any: "Changed attendance",
  left_in_person: "Left in-person and is no longer in-person",
  joined_in_person: "Joined in-person and is currently in-person",
};
export const booleanQueryValueSchema = z.enum(["true", "false"]);
export const eventRegistrationsQuerySchema = searchableListQuerySchema(
  sortColumnSchema(EVENT_REGISTRATIONS_SORT_COLUMNS),
).extend({
  status: eventRegistrationStatusSchema.optional(),
  bounced: booleanQueryValueSchema.optional(),
  consent: booleanQueryValueSchema.optional(),
  /** Whether the registration holds an active waitlist entry for at least one day. */
  waitlisted: booleanQueryValueSchema.optional(),
  attendance_change: eventRegistrationAttendanceChangeFilterSchema.optional(),
});

/**
 * What one event day holds for a registration: the attendance chosen for it
 * and, when that choice is in-person on a day that was full, where the
 * attendee stands on the day's waitlist. The whole-registration
 * `attendance_type` is a derivation — in-person wins over virtual wins over
 * on-demand — so a list that showed only it read a three-day registration
 * with one confirmed day and two waitlisted ones as plainly "in-person".
 */
export const registrationDayStateSchema = z.object({
  dayDate: z.string(),
  label: z.string().nullable(),
  attendanceType: z.string(),
  /** An active waitlist entry for the day, or null when the day is confirmed. */
  waitlistStatus: z.enum(["waiting", "offered"]).nullable(),
});
export type RegistrationDayState = z.infer<typeof registrationDayStateSchema>;
export type EventRegistrationsQuery = z.infer<typeof eventRegistrationsQuerySchema>;

export const eventRegistrationAttendanceChangeSchema = z.object({
  changedAt: z.string(),
  transitions: z.array(
    z.object({
      fromType: z.string(),
      toType: z.string(),
      days: z.array(z.object({ dayDate: z.string(), label: z.string().nullable() })),
    }),
  ),
});
export type EventRegistrationAttendanceChange = z.infer<typeof eventRegistrationAttendanceChangeSchema>;
export const eventRegistrationSummarySchema = registrationRecordContextSchema.extend({
  id: z.string(),
  user_id: z.string(),
  /** The attendee's portrait, so a roster row shows the person (#90). */
  headshot_url: z.string().nullable(),
  /** Who they represent and what they do, as the account states it (#119). */
  organization_name: z.string().nullable(),
  job_title: z.string().nullable(),
  status: eventRegistrationStatusSchema,
  attendance_type: z.string().nullable(),
  source_type: z.string().nullable(),
  rsvp_events_json: z.string().nullable(),
  has_bounced: z.boolean(),
  sponsor_consent: z.boolean(),
  custom_answers_json: z.string().nullable(),
  days: z.array(registrationDayStateSchema),
  attendanceChangeHistory: z.array(eventRegistrationAttendanceChangeSchema),
  lastAttendanceChange: eventRegistrationAttendanceChangeSchema.nullable(),
});
export type EventRegistrationSummary = z.infer<typeof eventRegistrationSummarySchema>;
export const eventRegistrationsStatsSchema = z.object({
  byAttendanceType: z.record(z.string(), z.number()),
  attendanceStatusByType: z.record(z.string(), z.object({ accepted: z.number(), waitlisted: z.number() })),
  byStatus: z.record(z.string(), z.number()),
  bouncedCount: z.number(),
  consentCount: z.number(),
});
export type EventRegistrationsStats = z.infer<typeof eventRegistrationsStatsSchema>;
export const eventRegistrationsListResponseSchema = paginatedResponseSchema(
  "registrations",
  eventRegistrationSummarySchema,
).extend({
  event: eventSummarySchema,
  stats: eventRegistrationsStatsSchema,
});
export type EventRegistrationsListResponse = z.infer<typeof eventRegistrationsListResponseSchema>;

/**
 * Least-privilege attendee list used by selected-group attendance managers.
 * Referral, form-answer, RSVP payload, delivery, and sponsor-consent fields
 * deliberately remain exclusive to the full administrator read model above.
 */
export const eventAttendanceRegistrationsQuerySchema = eventRegistrationsQuerySchema.pick({
  q: true,
  limit: true,
  offset: true,
  sort: true,
  status: true,
  waitlisted: true,
});
export type EventAttendanceRegistrationsQuery = z.infer<typeof eventAttendanceRegistrationsQuerySchema>;

export const eventAttendanceRegistrationSummarySchema = registrationRecordContextSchema
  .pick({ created_at: true, updated_at: true, user_email: true, display_name: true })
  .extend({
    id: z.string(),
    user_id: z.string(),
    headshot_url: z.string().nullable(),
    organization_name: z.string().nullable(),
    job_title: z.string().nullable(),
    status: eventRegistrationStatusSchema,
    attendance_type: z.string().nullable(),
    days: z.array(registrationDayStateSchema),
  });
export type EventAttendanceRegistrationSummary = z.infer<typeof eventAttendanceRegistrationSummarySchema>;

export const eventAttendanceRegistrationsStatsSchema = eventRegistrationsStatsSchema.pick({
  byAttendanceType: true,
  attendanceStatusByType: true,
  byStatus: true,
});
export type EventAttendanceRegistrationsStats = z.infer<typeof eventAttendanceRegistrationsStatsSchema>;

export const eventAttendanceRegistrationsListResponseSchema = paginatedResponseSchema(
  "registrations",
  eventAttendanceRegistrationSummarySchema,
).extend({
  event: eventSummarySchema,
  stats: eventAttendanceRegistrationsStatsSchema,
});
export type EventAttendanceRegistrationsListResponse = z.infer<typeof eventAttendanceRegistrationsListResponseSchema>;
