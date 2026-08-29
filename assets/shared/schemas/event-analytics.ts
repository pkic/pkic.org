import { z } from "zod";
import { databaseIdSchema } from "./identifiers";
import { eventSummarySchema } from "./event-read-models";

const countMapSchema = z.record(z.string(), z.number());

const attendanceChangeTransitionSchema = z.object({
  from_type: z.string(),
  to_type: z.string(),
  attendees: z.number(),
  day_changes: z.number(),
});

const attendanceChangeDaySchema = z.object({
  day_date: z.string(),
  label: z.string().nullable(),
  sort_order: z.number(),
  changed_attendees: z.number(),
  day_changes: z.number(),
  left_in_person_attendees: z.number(),
  joined_in_person_attendees: z.number(),
});

const inviteDeclineReasonCountSchema = z.object({
  reason_code: z.string().nullable(),
  count: z.number(),
  unsubscribed: z.number(),
});

const inviteStatsSchema = z.object({
  byStatus: countMapSchema,
  total: z.number(),
  declineReasons: z.array(inviteDeclineReasonCountSchema),
});

/** Event-scoped operational analytics; proposal totals are capability-filtered. */
export const eventAnalyticsResponseSchema = z.object({
  event: eventSummarySchema,
  registrations: z.object({
    byStatus: countMapSchema,
    byAttendanceType: countMapSchema,
    attendanceStatusByType: z.record(z.string(), z.object({ accepted: z.number(), waitlisted: z.number() })),
    byStatusAndType: z.array(z.object({ status: z.string(), attendance_type: z.string(), count: z.number() })),
    sponsorConsent: z.object({ granted: z.number(), notGranted: z.number() }),
    total: z.number(),
    growthByDay: z.array(z.object({ date: z.string(), attendance_type: z.string(), count: z.number() })),
  }),
  waitlistByEventDay: z.array(
    z.object({
      day_date: z.string(),
      label: z.string().nullable(),
      sort_order: z.number(),
      status: z.string(),
      priority_lane: z.string(),
      count: z.number(),
    }),
  ),
  waitlistTotals: z.object({ total: z.number(), byStatus: countMapSchema, byPriorityLane: countMapSchema }),
  attendanceChanges: z.object({
    totalChanges: z.number(),
    changedRegistrations: z.number(),
    dayChanges: z.number(),
    changedAttendees: z.number(),
    leftInPersonAttendees: z.number(),
    leftInPersonDayChanges: z.number(),
    joinedInPersonAttendees: z.number(),
    joinedInPersonDayChanges: z.number(),
    byTransition: z.array(attendanceChangeTransitionSchema),
    byDay: z.array(attendanceChangeDaySchema),
    recent: z.array(
      z.object({
        registration_id: databaseIdSchema,
        changed_at: z.string(),
        from_type: z.string(),
        to_type: z.string(),
        user_email: z.string().nullable(),
        display_name: z.string().nullable(),
        days: z.array(z.object({ day_date: z.string(), label: z.string().nullable() })),
      }),
    ),
  }),
  registrationsByEventDay: z.array(
    z.object({
      day_date: z.string(),
      label: z.string().nullable(),
      sort_order: z.number(),
      attendance_type: z.string(),
      attendance_status: z.enum(["accepted", "waitlisted", "pending"]),
      count: z.number(),
    }),
  ),
  invites: z.object({
    attendee: inviteStatsSchema,
    speaker: inviteStatsSchema,
  }),
  proposals: z.object({ byStatus: countMapSchema, total: z.number() }).nullable(),
  rsvp: z.object({
    total: z.number(),
    byStatus: countMapSchema,
    byProvider: countMapSchema,
    actionsTaken: countMapSchema,
  }),
});

export type EventAnalyticsResponse = z.infer<typeof eventAnalyticsResponseSchema>;
