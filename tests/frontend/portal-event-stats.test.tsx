import { eventAnalyticsFixture as analytics } from "../helpers/event-analytics";
// @vitest-environment jsdom
import { render, type ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventStats } from "../../assets/ts/member-flows/portal/sections/events/detail/EventStats";

// The page's sections are routed tabs, so it reads the portal's location hook
// and renders wouter links — neither of which has a dispatcher in a bare mount.
vi.mock("wouter/use-hash-location", () => ({ useHashLocation: () => ["", vi.fn()] }));
vi.mock("wouter", () => ({
  Link: ({ children, href, ...rest }: { children?: ComponentChildren; href: string } & Record<string, unknown>) => (
    <a href={`#${href}`} {...rest}>
      {children}
    </a>
  ),
}));
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

    // The page is sectioned (#118): the overview carries the figures, and the
    // tables live in their own sections, each reached by a routed tab.
    const tabs = [...container.querySelectorAll('[aria-label="Analytics sections"] a')].map((tab) =>
      tab.textContent?.trim(),
    );
    expect(tabs).toEqual([
      "Overview",
      "Registration changes",
      "Registrations",
      "Invitations",
      "Calendar",
      "Promoters",
      "Session demand",
    ]);
    expect([...container.querySelectorAll("caption")].map((node) => node.textContent)).not.toContain(
      "Attendee invites by status",
    );
  });

  it("shows invitation summaries as labeled charts without duplicate tables", async () => {
    stubAnalyticsFetch(() => jsonResponse(analytics()));

    mount(<EventStats slug={SLUG} section="registrations" />);
    await settle();
    expect([...container.querySelectorAll("caption")].map((node) => node.textContent)).toContain(
      "Open waitlist by event day",
    );

    mount(<EventStats slug={SLUG} section="invitations" />);
    await settle();
    expect(container.querySelectorAll("table")).toHaveLength(0);
    expect(container.querySelector('[aria-label="Attendee invites"]')).not.toBeNull();
    expect(container.querySelectorAll(".pk-chart__bars").length).toBeGreaterThan(0);
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

    // The growth chart lives in the Registrations section (#118).
    mount(<EventStats slug={SLUG} section="registrations" />);
    await settle();

    // Scoped to the growth panel: the page renders several empty states when
    // there is no data at all, and asserting on "the first one" makes this
    // test depend on the order the panels happen to be in.
    const growthPanel = [...container.querySelectorAll(".pk-panel")].find((panel) =>
      panel.textContent?.includes("Registrations received by day"),
    );
    expect(growthPanel?.querySelector(".pk-empty-state")?.textContent).toContain("No registrations yet.");

    const text = container.textContent ?? "";
    // Sections with no data at all are absent rather than rendered blank.
    expect(text).not.toContain("Open waitlist by event day");
    expect(text).not.toContain("Calendar RSVP");
    expect(text).not.toContain("Proposals");
    // Nothing is actionable, so nothing is claimed to be.
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
});

it("opens attendance imports without fetching an unauthorized analytics dashboard", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  mount(
    <EventStats
      slug={SLUG}
      section="attendance"
      basePath="/groups/group/events/event/stats"
      canViewAnalytics={false}
      attendance={{ timeZone: "Europe/Amsterdam", canRead: false, canImport: true, canCorrect: false }}
    />,
  );
  await vi.waitFor(async () => {
    await settle();
    expect(container.querySelector('[aria-label="Attendance sections"]')).not.toBeNull();
  });
  const analyticsLinks = [...container.querySelectorAll('[aria-label="Analytics sections"] a')];
  expect(analyticsLinks.map((link) => link.textContent?.trim())).toEqual(["Attendance"]);
  expect(container.querySelector('[aria-label="Attendance sections"] a')?.getAttribute("href")).toBe(
    "#/groups/group/events/event/stats/attendance/imports",
  );
  expect(fetch).not.toHaveBeenCalled();
});
