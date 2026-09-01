// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { eventAttendanceRegistrationsListResponseSchema } from "../../assets/shared/schemas/event-registrations";
import { GroupEventRegistrations } from "../../assets/ts/member-flows/portal/sections/management/GroupEventRegistrations";

const GROUP_ID = "10000000-0000-4000-8000-000000000001";
const EVENT_ID = "20000000-0000-4000-8000-000000000001";
const REGISTRATION_ID = "30000000-0000-4000-8000-000000000001";
const REGISTRATION_ENDPOINT = `/api/v1/groups/${GROUP_ID}/events/${EVENT_ID}/registrations/${REGISTRATION_ID}`;
const mounted: HTMLElement[] = [];

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
}

function mount(canVip = false): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  mounted.push(container);
  void act(() => render(<GroupEventRegistrations groupId={GROUP_ID} eventId={EVENT_ID} canVip={canVip} />, container));
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
      if (method === "POST" && url.pathname === `${REGISTRATION_ENDPOINT}/admissions`) {
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
  // The row itself is the control: its stretched activation is a real
  // button whose name says whose attendance it opens.
  const button = Array.from(container.querySelectorAll<HTMLButtonElement>("button.pk-table__row-link")).find(
    (candidate) => candidate.textContent?.startsWith("Manage attendance for"),
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
      path: `${REGISTRATION_ENDPOINT}/admissions`,
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

  it("shows the reasoned VIP override only with event manage and sends its explicit selected-day payload", async () => {
    const hiddenRequests = installApi(false);
    const hidden = mount(false);
    await openAttendance(hidden);
    expect(hidden.textContent).not.toContain("Reasoned VIP admission override");
    expect(hiddenRequests.some(({ method }) => method === "POST")).toBe(false);

    vi.unstubAllGlobals();
    const requests = installApi(false);
    const container = mount(true);
    await openAttendance(container);

    expect(container.textContent).toContain("Requires the effective event manage capability");
    const vipDay = container.querySelector<HTMLInputElement>(`#group-registration-${REGISTRATION_ID}-vip-2026-09-01`);
    const reason = container.querySelector<HTMLTextAreaElement>(`#group-registration-${REGISTRATION_ID}-vip-reason`);
    expect(vipDay).not.toBeNull();
    expect(reason).not.toBeNull();
    await act(async () => {
      vipDay?.click();
      if (reason) {
        reason.value = "Approved consortium guest";
        reason.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });

    const applyButton = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent === "Apply VIP override",
    );
    expect(applyButton?.disabled).toBe(false);
    await act(async () => {
      applyButton?.click();
    });
    await settle();

    expect(requests).toContainEqual({
      path: `${REGISTRATION_ENDPOINT}/admissions`,
      method: "POST",
      body: {
        mode: "vip",
        reason: "Approved consortium guest",
        dayDates: ["2026-09-01"],
      },
    });
    expect(container.textContent).toContain("VIP override applied");
    expect(requests.some(({ path }) => path.startsWith("/api/v1/admin/"))).toBe(false);
  });

  it("names the roster and every one of its columns", async () => {
    installApi(false);
    const container = mount();
    await settle();

    expect(container.querySelector("caption")?.textContent).toBe("Event attendees");
    const headers = [...container.querySelectorAll("thead th")].map((cell) =>
      (cell.textContent ?? "").replace(/[↑↓↕]/g, "").trim(),
    );
    expect(headers).toEqual(["Name / email", "Status", "Attendance", "Registered"]);
    // No blank header: the per-row toggle became the row's own activation.
    for (const header of headers) expect(header).not.toBe("");
  });

  it("gives each row's toggle a name that says whose attendance it opens", async () => {
    installApi(false);
    const container = mount();
    await settle();

    const toggle = Array.from(container.querySelectorAll<HTMLButtonElement>("button.pk-table__row-link")).find(
      (candidate) => candidate.textContent === "Manage attendance for Group Member",
    );
    expect(toggle).not.toBeUndefined();

    await act(async () => {
      toggle?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await settle();

    const openedToggle = Array.from(container.querySelectorAll<HTMLButtonElement>("button.pk-table__row-link")).find(
      (candidate) => candidate.textContent === "Hide attendance for Group Member",
    );
    expect(openedToggle).not.toBeUndefined();
  });

  it("serves the roster the shared list contract describes", async () => {
    const captured: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        if (url.pathname.endsWith(`/events/${EVENT_ID}/registrations`)) {
          const body = registrationList();
          captured.push(body);
          return Promise.resolve(json(body));
        }
        throw new Error(`Unexpected request: ${url.pathname}`);
      }),
    );
    const container = mount();
    await settle();

    // The fixture is held to the shared response contract rather than to a
    // shape this test invented.
    for (const body of captured) expect(() => eventAttendanceRegistrationsListResponseSchema.parse(body)).not.toThrow();
    expect(container.textContent).toContain("Group Member");
  });

  it("states the failure when the roster cannot be loaded", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ error: { code: "server_error", message: "HTTP 500" } }), {
            status: 500,
            headers: { "content-type": "application/json" },
          }),
        ),
      ),
    );
    const container = mount();
    await settle();

    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("Something went wrong on our side.");
    // The heading stays, so the reader still knows what failed to load.
    expect(container.querySelector("h3")?.textContent).toBe("Attendees");
  });

  it("names the opened attendance region and states its type in the shared words", async () => {
    installApi(false);
    const container = mount();
    await openAttendance(container);

    // The expanded region names itself, so it is reachable as a region rather
    // than being an unlabelled run of text inside a table row.
    const region = container.querySelector<HTMLElement>('section[aria-label="Attendance for Group Member"]');
    expect(region).not.toBeNull();
    expect(region?.querySelector("h4")?.textContent).toBe("Group Member");
    expect(region?.textContent).toContain("member@example.test");
    // The shared vocabulary rather than an underscore-stripping replace, so
    // "in_person" reads as "In-person" here exactly as it does on the roster.
    expect(region?.textContent).toContain("In-person");
    expect(region?.textContent).not.toContain("in person");
  });

  it("states the failure when one registration's attendance cannot be loaded", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        if (url.pathname === REGISTRATION_ENDPOINT) {
          return Promise.resolve(
            new Response(JSON.stringify({ error: { code: "NOT_FOUND", message: "That registration is gone." } }), {
              status: 404,
              headers: { "content-type": "application/json" },
            }),
          );
        }
        return Promise.resolve(json(registrationList()));
      }),
    );
    const container = mount();
    await openAttendance(container);

    // The detail row says why it is empty instead of collapsing to nothing,
    // and the roster behind it is untouched.
    const alerts = [...container.querySelectorAll('[role="alert"]')].map((node) => node.textContent ?? "");
    expect(alerts.some((text) => text.includes("That registration is gone."))).toBe(true);
    expect(container.textContent).toContain("Group Member");
  });
});
