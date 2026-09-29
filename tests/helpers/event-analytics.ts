import type { EventAnalyticsResponse } from "../../assets/shared/schemas/event-analytics";

/** A response shaped exactly like the canonical analytics contract. */
export function eventAnalyticsFixture(overrides: Partial<EventAnalyticsResponse> = {}): EventAnalyticsResponse {
  return {
    event: { id: "pqc-2026", slug: "pqc-2026", name: "PQC 2026" },
    registrations: {
      byStatus: { registered: 9, pending_email_confirmation: 2 },
      byAttendanceType: { in_person: 6, virtual: 5 },
      attendanceStatusByType: {
        in_person: { accepted: 4, waitlisted: 2 },
        virtual: { accepted: 3, waitlisted: 0 },
      },
      byStatusAndType: [{ status: "registered", attendance_type: "in_person", count: 6 }],
      sponsorConsent: { granted: 3, notGranted: 1 },
      total: 11,
      growthByDay: [
        { date: "2026-03-01", attendance_type: "in_person", count: 4 },
        { date: "2026-03-02", attendance_type: "virtual", count: 3 },
      ],
    },
    waitlistByEventDay: [
      {
        day_date: "2026-06-01",
        label: "Day one",
        sort_order: 1,
        status: "waiting",
        priority_lane: "general",
        count: 5,
      },
      {
        day_date: "2026-06-01",
        label: "Day one",
        sort_order: 1,
        status: "offered",
        priority_lane: "general",
        count: 2,
      },
    ],
    waitlistTotals: { total: 7, byStatus: { waiting: 5, offered: 2, accepted: 1 }, byPriorityLane: { general: 7 } },
    attendanceChanges: {
      totalChanges: 0,
      changedRegistrations: 0,
      dayChanges: 0,
      changedAttendees: 0,
      leftInPersonAttendees: 0,
      leftInPersonDayChanges: 0,
      joinedInPersonAttendees: 0,
      joinedInPersonDayChanges: 0,
      byTransition: [],
      byDay: [],
      recent: [],
    },
    registrationsByEventDay: [
      {
        day_date: "2026-06-01",
        label: "Day one",
        sort_order: 1,
        attendance_type: "in_person",
        attendance_status: "accepted",
        count: 4,
      },
      {
        day_date: "2026-06-01",
        label: "Day one",
        sort_order: 1,
        attendance_type: "in_person",
        attendance_status: "waitlisted",
        count: 2,
      },
    ],
    invites: {
      attendee: {
        byStatus: { sent: 8, accepted: 5, declined: 1 },
        total: 14,
        declineReasons: [{ reason_code: "schedule_conflict", count: 1, unsubscribed: 0 }],
      },
      speaker: { byStatus: { sent: 2 }, total: 2, declineReasons: [] },
    },
    proposals: { byStatus: { submitted: 4 }, total: 4 },
    rsvp: { total: 3, byStatus: { accepted: 2, declined: 1 }, byProvider: { google: 3 }, actionsTaken: { added: 3 } },
    ...overrides,
  };
}
