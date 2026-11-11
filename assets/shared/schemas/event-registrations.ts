import { countryCodeSchema } from "../countries";
import { z } from "zod";
import { successResponseSchema, utcInstantSchema } from "./api-common";
import { eventAttendanceTypeValueSchema, eventDayDateSchema, eventSummarySchema } from "./event-read-models";
import { badgeDisplayRoleSchema } from "./participant-roles";
import { databaseIdSchema } from "./identifiers";
import { paginatedResponseSchema, searchableListQuerySchema, sortColumnSchema } from "./pagination";
import { registrationRecordContextSchema } from "./registration-record";

export const EVENT_REGISTRATIONS_SORT_COLUMNS = ["display_name", "status", "created_at"] as const;
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
  optionLabel: z.string().optional(),
  /** An active waitlist entry for the day, or null when the day is confirmed. */
  waitlistStatus: z.enum(["waiting", "offered", "expired"]).nullable(),
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
  /** A consumer mailbox: organizers see "Personal email address" in place of an organization. */
  personal_email: z.boolean(),
  /** Waiting for a day while holding no verified work address: handled after every other entry. */
  waitlist_handled_last: z.boolean(),
  job_title: z.string().nullable(),
  status: eventRegistrationStatusSchema,
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
/**
 * People who chose an attendance type for at least one day, cancelled
 * registrations aside. `accepted` and `waitlisted` each count a person with at
 * least one such day off or on the waitlist, so one person can be in both.
 */
export const attendanceStatusCountSchema = z.object({
  total: z.number(),
  accepted: z.number(),
  waitlisted: z.number(),
  expired: z.number().default(0),
});
export type AttendanceStatusCount = z.infer<typeof attendanceStatusCountSchema>;
export const eventRegistrationsStatsSchema = z.object({
  byAttendanceType: z.record(z.string(), z.number()),
  attendanceStatusByType: z.record(z.string(), attendanceStatusCountSchema),
  byStatus: z.record(z.string(), z.number()),
  /** Registrations, cancelled ones aside, waiting for or offered a seat on at least one day. */
  waitlistedCount: z.number(),
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

/** A bounded, bookmarkable set of event-local calendar dates. */
export const registrationDayDatesQuerySchema = z
  .string()
  .max(340)
  .refine((value) => {
    const dates = value.split(",");
    return (
      z.array(eventDayDateSchema).min(1).max(31).safeParse(dates).success &&
      new Set(dates).size === dates.length &&
      dates.every((date) => date === date.trim())
    );
  }, "Choose up to 31 distinct event dates.");

/** A bounded, bookmarkable set of attendance types: "in_person,livestream_lounge". */
export const registrationAttendanceTypesQuerySchema = z
  .string()
  .max(650)
  .refine((value) => {
    const types = value.split(",");
    return (
      z.array(eventAttendanceTypeValueSchema).min(1).max(10).safeParse(types).success &&
      new Set(types).size === types.length
    );
  }, "Choose up to 10 distinct attendance types.");

/** A bounded, bookmarkable set of registration statuses: "registered,pending_email_confirmation". */
export const registrationStatusesQuerySchema = z
  .string()
  .max(120)
  .refine((value) => {
    const statuses = value.split(",");
    return (
      z.array(eventRegistrationStatusSchema).min(1).safeParse(statuses).success &&
      new Set(statuses).size === statuses.length
    );
  }, "Choose distinct registration statuses.");

export const eventAttendanceRegistrationsQuerySchema = eventRegistrationsQuerySchema
  .pick({
    q: true,
    limit: true,
    offset: true,
    sort: true,
    waitlisted: true,
    consent: true,
  })
  .extend({
    /** Match any of the selected statuses. */
    status: registrationStatusesQuerySchema.optional(),
    job_title: z.string().trim().min(1).max(200).optional(),
    country: countryCodeSchema.optional(),
    /** Match attendance options selected on at least one day. */
    attendance_type: registrationAttendanceTypesQuerySchema.optional(),
    /** `all`: every selected option on at least one day; otherwise any of them. */
    attendance_match: z.enum(["any", "all"]).optional(),
    day_dates: registrationDayDatesQuerySchema.optional(),
    day_match: z.enum(["any", "all"]).optional(),
    /** The role band the registration's badge prints. */
    badge_role: badgeDisplayRoleSchema.optional(),
    created_since: utcInstantSchema.optional(),
  });
export type EventAttendanceRegistrationsQuery = z.infer<typeof eventAttendanceRegistrationsQuerySchema>;

/**
 * Least-privilege attendee list used by selected-group attendance managers.
 * Referral, form-answer, RSVP payload, and delivery fields
 * deliberately remain exclusive to the full administrator read model above.
 */
export const eventAttendanceRegistrationSummarySchema = registrationRecordContextSchema
  .pick({ created_at: true, updated_at: true, user_email: true, display_name: true })
  .extend({
    id: z.string(),
    user_id: z.string(),
    headshot_url: z.string().nullable(),
    organization_name: z.string().nullable(),
    /** A consumer mailbox: organizers see "Personal email address" in place of an organization. */
    personal_email: z.boolean(),
    /** Waiting for a day while holding no verified work address: handled after every other entry. */
    waitlist_handled_last: z.boolean(),
    job_title: z.string().nullable(),
    country: z.string().nullable().default(null),
    sponsor_consent: z.boolean().default(false),
    badge_role: badgeDisplayRoleSchema.default("attendee"),
    status: eventRegistrationStatusSchema,
    days: z.array(registrationDayStateSchema),
  });
export type EventAttendanceRegistrationSummary = z.infer<typeof eventAttendanceRegistrationSummarySchema>;

export const eventAttendanceRegistrationsStatsSchema = eventRegistrationsStatsSchema.pick({
  byAttendanceType: true,
  attendanceStatusByType: true,
  byStatus: true,
  waitlistedCount: true,
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
