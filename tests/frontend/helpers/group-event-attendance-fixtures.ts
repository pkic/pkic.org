/** Shared fixtures for the group event attendee roster and registration record tests. */

export const GROUP_ID = "10000000-0000-4000-8000-000000000001";
export const EVENT_ID = "20000000-0000-4000-8000-000000000001";
export const REGISTRATION_ID = "30000000-0000-4000-8000-000000000001";
export const REGISTRATION_ENDPOINT = `/api/v1/groups/${GROUP_ID}/events/${EVENT_ID}/registrations/${REGISTRATION_ID}`;
export const EVENT_SLUG = "architecture-workshop";
export const MANAGE_ACCESS_ENDPOINT = `/api/v1/events/${EVENT_SLUG}/registrations/${REGISTRATION_ID}/access`;

export function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

export function registrationList() {
  return {
    event: { id: EVENT_ID, slug: "architecture-workshop", name: "Architecture workshop" },
    registrations: [
      {
        id: REGISTRATION_ID,
        user_id: "40000000-0000-4000-8000-000000000001",
        user_email: "member@example.test",
        display_name: "Group Member",
        headshot_url: null,
        organization_name: null,
        job_title: null,
        status: "registered",
        attendance_type: "in_person",
        days: [
          { dayDate: "2026-09-01", label: "Day one", attendanceType: "in_person", waitlistStatus: null },
          { dayDate: "2026-09-02", label: "Day two", attendanceType: "in_person", waitlistStatus: "waiting" },
          { dayDate: "2026-09-03", label: "Day three", attendanceType: "virtual", waitlistStatus: null },
        ],
        created_at: "2026-08-01T00:00:00.000Z",
        updated_at: "2026-08-01T00:00:00.000Z",
      },
    ],
    stats: {
      byAttendanceType: { in_person: 1 },
      attendanceStatusByType: { in_person: { accepted: 1, waitlisted: 1 } },
      byStatus: { registered: 1 },
    },
    page: { limit: 50, offset: 0, total: 1, hasMore: false },
  };
}

export function attendanceDetail(waitlisted: boolean) {
  return {
    registration: {
      id: REGISTRATION_ID,
      event_id: EVENT_ID,
      user_id: "40000000-0000-4000-8000-000000000001",
      user_email: "member@example.test",
      display_name: "Group Member",
      status: "registered",
      attendance_type: "in_person",
      source_type: "direct",
      created_at: "2026-08-01T00:00:00.000Z",
      updated_at: "2026-08-01T00:00:00.000Z",
    },
    dayAttendance: [{ dayDate: "2026-09-01", attendanceType: "in_person", label: "Day one" }],
    dayWaitlist: waitlisted
      ? [{ dayDate: "2026-09-01", status: "waiting", priorityLane: "general", offerExpiresAt: null }]
      : [],
    eventDays: [
      {
        id: "50000000-0000-4000-8000-000000000001",
        date: "2026-09-01",
        label: "Day one",
        startsAt: null,
        endsAt: null,
        sortOrder: 0,
        attendanceOptions: [
          { value: "in_person", label: "In-person", capacity: 10 },
          { value: "livestream", label: "Live stream", capacity: null },
        ],
        attendanceCounts: { in_person: 10 },
      },
    ],
  };
}
