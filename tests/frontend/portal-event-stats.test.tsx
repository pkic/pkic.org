// @vitest-environment jsdom
import { render, type ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventStats } from "../../assets/ts/member-flows/portal/sections/events/detail/EventStats";
import type { EventAnalyticsResponse } from "../../assets/shared/schemas/event-analytics";

const SLUG = "pqc-2026";

let container: HTMLDivElement;

function mount(node: ComponentChildren): void {
  void act(() => render(node, container));
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** A response shaped exactly like the canonical analytics contract. */
function analytics(overrides: Partial<EventAnalyticsResponse> = {}): EventAnalyticsResponse {
  return {
    event: { id: "pqc-2026", slug: SLUG, name: "PQC 2026" },
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

/** The same contract with nothing recorded yet — the surface's empty path. */
function emptyAnalytics(): EventAnalyticsResponse {
  return analytics({
    registrations: {
      byStatus: {},
      byAttendanceType: {},
      attendanceStatusByType: {},
      byStatusAndType: [],
      sponsorConsent: { granted: 0, notGranted: 0 },
      total: 0,
      growthByDay: [],
    },
    waitlistByEventDay: [],
    waitlistTotals: { total: 0, byStatus: {}, byPriorityLane: {} },
    registrationsByEventDay: [],
    invites: {
      attendee: { byStatus: {}, total: 0, declineReasons: [] },
      speaker: { byStatus: {}, total: 0, declineReasons: [] },
    },
    proposals: null,
    rsvp: { total: 0, byStatus: {}, byProvider: {}, actionsTaken: {} },
  });
}

function stubAnalyticsFetch(respond: (url: URL) => Response | Promise<Response>): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const url = new URL(href, location.origin);
      if (url.pathname !== `/api/v1/events/${SLUG}/analytics`) {
        throw new Error(`Unexpected request: ${url.pathname}`);
      }
      return respond(url);
    }),
  );
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
});

afterEach(() => {
  void act(() => render(null, container));
  container.remove();
  vi.unstubAllGlobals();
});

describe("portal event statistics", () => {
  it("renders every headline statistic with its label", async () => {
    stubAnalyticsFetch(() => jsonResponse(analytics()));

    mount(<EventStats slug={SLUG} />);
    await settle();

    const heading = container.querySelector("h2");
    expect(heading?.textContent).toBe("Event dashboard");

    const text = container.textContent ?? "";
    for (const label of [
      "Accepted attendees",
      "Waitlisted attendees",
      "Pending confirmation",
      "Total registrations",
      "Proposals",
      "Sponsor consent",
    ]) {
      expect(text).toContain(label);
    }

    // Accepted (4 in-person + 3 virtual) and waitlisted (2) are derived, not
    // echoed from a single field, so the totals are what the surface promises.
    const values = [...container.querySelectorAll(".pk-stat-card")].map((card) => ({
      label: card.querySelector(".pk-stat-card__label")?.textContent,
      value: card.querySelector(".pk-stat-card__value")?.textContent,
    }));
    expect(values).toEqual(
      expect.arrayContaining([
        { label: "Accepted attendees", value: "7" },
        { label: "Waitlisted attendees", value: "2" },
        { label: "Pending confirmation", value: "2" },
        { label: "Total registrations", value: "11" },
        { label: "Sponsor consent", value: "3" },
      ]),
    );

    // Every table names itself, so the five on this surface stay tellable apart.
    const captions = [...container.querySelectorAll("caption")].map((node) => node.textContent);
    expect(captions).toContain("Open waitlist by event day");
    expect(captions).toContain("Attendee invites by status");
    expect(captions).toContain("Speaker invites by status");
  });

  it("states the actionable counts in words rather than as a colour alone", async () => {
    stubAnalyticsFetch(() => jsonResponse(analytics()));

    mount(<EventStats slug={SLUG} />);
    await settle();

    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("2 attendees are on an active day waitlist");
    expect(alert?.textContent).toContain("2 registrations have not confirmed their email");
  });

  it("announces that it is loading before the analytics response arrives", async () => {
    let release: ((response: Response) => void) | undefined;
    stubAnalyticsFetch(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    );

    mount(<EventStats slug={SLUG} />);

    const status = container.querySelector('[role="status"]');
    expect(status?.textContent).toContain("Loading the event dashboard…");
    expect(container.querySelector("h2")).toBeNull();

    release?.(jsonResponse(analytics()));
    await settle();
    expect(container.querySelector("h2")?.textContent).toBe("Event dashboard");
  });

  it("replaces the dashboard with a readable message when the request is refused", async () => {
    stubAnalyticsFetch(() => new Response(null, { status: 403 }));

    mount(<EventStats slug={SLUG} />);
    await settle();

    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("You don't have access to this.");
    // The transport phrasing never reaches the reader, and no partial
    // dashboard is left on screen behind the error.
    expect(container.textContent).not.toContain("HTTP 403");
    expect(container.querySelector("h2")).toBeNull();
    expect(container.querySelector(".pk-stat-card")).toBeNull();
  });

  it("shows an empty state instead of an unlabelled chart when nothing is recorded", async () => {
    stubAnalyticsFetch(() => jsonResponse(emptyAnalytics()));

    mount(<EventStats slug={SLUG} />);
    await settle();

    const empty = container.querySelector(".pk-empty-state");
    expect(empty?.textContent).toContain("No registrations yet.");

    const text = container.textContent ?? "";
    // Sections with no data at all are absent rather than rendered blank.
    expect(text).not.toContain("Open waitlist by event day");
    expect(text).not.toContain("Calendar RSVP");
    expect(text).not.toContain("Proposals");
    // Nothing is actionable, so nothing is claimed to be.
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
});
