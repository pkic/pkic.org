// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GroupEventRegistrations } from "../../assets/ts/member-flows/portal/sections/management/GroupEventRegistrations";

const GROUP_ID = "10000000-0000-4000-8000-000000000001";
const EVENT_ID = "20000000-0000-4000-8000-000000000001";
const REGISTRATION_ID = "30000000-0000-4000-8000-000000000001";
const REGISTRATION_ENDPOINT = `/api/v1/groups/${GROUP_ID}/events/${EVENT_ID}/registrations/${REGISTRATION_ID}`;
const mounted: HTMLElement[] = [];

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
}

function mount(): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  mounted.push(container);
  void act(() => render(<GroupEventRegistrations groupId={GROUP_ID} eventId={EVENT_ID} />, container));
  return container;
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function registrationList() {
  return {
    event: { id: EVENT_ID, slug: "architecture-workshop", name: "Architecture workshop" },
    registrations: [
      {
        id: REGISTRATION_ID,
        user_id: "40000000-0000-4000-8000-000000000001",
        user_email: "member@example.test",
        display_name: "Group Member",
        referral_code: null,
        status: "registered",
        attendance_type: "in_person",
        source_type: "direct",
        rsvp_events_json: null,
        has_bounced: false,
        sponsor_consent: false,
        custom_answers_json: null,
        dayWaitlistSummary: null,
        dayWaitlistCount: 0,
        attendanceChangeHistory: [],
        lastAttendanceChange: null,
        created_at: "2026-08-01T00:00:00.000Z",
        updated_at: "2026-08-01T00:00:00.000Z",
      },
    ],
    stats: {
      byAttendanceType: { in_person: 1 },
      attendanceStatusByType: { in_person: { accepted: 1, waitlisted: 0 } },
      byStatus: { registered: 1 },
      bouncedCount: 0,
      consentCount: 1,
    },
    page: { limit: 50, offset: 0, total: 1, hasMore: false },
  };
}

function attendanceDetail(waitlisted: boolean) {
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
      ? [
          {
            dayDate: "2026-09-01",
            status: "waiting",
            priorityLane: "general",
            offerExpiresAt: null,
          },
        ]
      : [],
    eventDays: eventDays().days,
  };
}

function eventDays() {
  return {
    days: [
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

function installApi(waitlisted: boolean) {
  const requests: Array<{ path: string; method: string; body?: unknown }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = new URL(
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
        location.origin,
      );
      const method = init.method ?? "GET";
      const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
      requests.push({ path: url.pathname, method, body });
      if (method === "GET" && url.pathname.endsWith(`/events/${EVENT_ID}/registrations`)) {
        return json(registrationList());
      }
      if (method === "GET" && url.pathname === REGISTRATION_ENDPOINT) return json(attendanceDetail(waitlisted));
      if (method === "PATCH" && url.pathname === `${REGISTRATION_ENDPOINT}/day-attendance`) {
        return json({ success: true });
      }
      if (method === "POST" && url.pathname === `${REGISTRATION_ENDPOINT}/admit`) {
        return json({
          success: true,
          registration: attendanceDetail(false).registration,
          admittedDayDates: ["2026-09-01"],
        });
      }
      throw new Error(`Unexpected request: ${method} ${url.pathname}`);
    }),
  );
  return requests;
}

async function openAttendance(container: HTMLElement): Promise<void> {
  await settle();
  const button = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent === "Manage attendance",
  );
  await act(async () => {
    button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await settle();
  await settle();
}

afterEach(() => {
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
  vi.unstubAllGlobals();
});

describe("portal event attendance management", () => {
  it("returns an accepted in-person day to its per-day waitlist through the canonical group route", async () => {
    const requests = installApi(false);
    const container = mount();
    await openAttendance(container);

    expect(
      Array.from(container.querySelectorAll("option")).some((option) => option.textContent === "Live stream"),
    ).toBe(true);

    const returnButton = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent === "Return to waitlist",
    );
    await act(async () => {
      returnButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await settle();

    expect(requests).toContainEqual({
      path: `${REGISTRATION_ENDPOINT}/day-attendance`,
      method: "PATCH",
      body: { action: "waitlist", dayDates: ["2026-09-01"] },
    });
    expect(requests.some(({ path }) => path.endsWith(`/events/${EVENT_ID}/days`))).toBe(false);
    expect(requests.some(({ path }) => path.startsWith("/api/v1/admin/"))).toBe(false);
  });

  it("admits a selected waitlisted day without changing a registration-wide waitlist status", async () => {
    const requests = installApi(true);
    const container = mount();
    await openAttendance(container);

    const checkbox = container.querySelector<HTMLInputElement>(
      `#group-registration-${REGISTRATION_ID}-admit-2026-09-01`,
    );
    expect(checkbox).not.toBeNull();
    expect(checkbox?.disabled).toBe(false);
    await act(async () => {
      checkbox?.click();
    });
    expect(checkbox?.checked).toBe(true);
    const admitButton = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent === "Admit selected days",
    );
    await act(async () => {
      admitButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await settle();

    expect(requests).toContainEqual({
      path: `${REGISTRATION_ENDPOINT}/admit`,
      method: "POST",
      body: {
        mode: "capacity_exempt",
        reason: "Event manager approved in-person admission",
        dayDates: ["2026-09-01"],
      },
    });
    expect(container.textContent).toContain("registration update email was queued");
    expect(requests.some(({ path }) => path.endsWith(`/events/${EVENT_ID}/days`))).toBe(false);
    expect(requests.some(({ path }) => path.startsWith("/api/v1/admin/"))).toBe(false);
  });
});
