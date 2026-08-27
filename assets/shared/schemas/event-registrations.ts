import { z } from "zod";
import { eventSummarySchema } from "./event-read-models";
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

export const eventRegistrationAttendanceChangeFilterSchema = z.enum(["any", "left_in_person", "joined_in_person"]);
export const booleanQueryValueSchema = z.enum(["true", "false"]);
export const eventRegistrationsQuerySchema = searchableListQuerySchema(
  sortColumnSchema(EVENT_REGISTRATIONS_SORT_COLUMNS),
).extend({
  status: eventRegistrationStatusSchema.optional(),
  bounced: booleanQueryValueSchema.optional(),
  consent: booleanQueryValueSchema.optional(),
  attendance_change: eventRegistrationAttendanceChangeFilterSchema.optional(),
});
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
  status: eventRegistrationStatusSchema,
  attendance_type: z.string().nullable(),
  source_type: z.string().nullable(),
  rsvp_events_json: z.string().nullable(),
  has_bounced: z.boolean(),
  sponsor_consent: z.boolean(),
  custom_answers_json: z.string().nullable(),
  dayWaitlistSummary: z.string().nullable(),
  dayWaitlistCount: z.number(),
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
});
export type EventAttendanceRegistrationsQuery = z.infer<typeof eventAttendanceRegistrationsQuerySchema>;

export const eventAttendanceRegistrationSummarySchema = registrationRecordContextSchema
  .pick({ created_at: true, updated_at: true, user_email: true, display_name: true })
  .extend({
    id: z.string(),
    user_id: z.string(),
    status: eventRegistrationStatusSchema,
    attendance_type: z.string().nullable(),
    dayWaitlistSummary: z.string().nullable(),
    dayWaitlistCount: z.number(),
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
