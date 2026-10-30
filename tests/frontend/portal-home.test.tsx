// @vitest-environment jsdom
/**
 * The portal landing. Each panel is a bounded self-scoped server page, so the
 * three states a panel can be in — loading, failed, empty — matter more than
 * any one row's copy, and each has to be announced rather than merely drawn.
 */
import { render, type ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Home } from "../../assets/ts/member-flows/portal/sections/Home";
import { portalSession, profile } from "../../assets/ts/member-flows/portal/state";
import { portalSessionFixture } from "../helpers/portal-session";
import { memoryStorage } from "./helpers/browser-storage";

vi.mock("wouter", () => ({
  Link: ({ children, href, class: className }: { children?: ComponentChildren; href: string; class?: string }) => (
    <a href={`#${href}`} class={className}>
      {children}
    </a>
  ),
}));

const mounted: HTMLElement[] = [];

function mount(): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  mounted.push(container);
  void act(() => render(<Home />, container));
  return container;
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
}

const emptyPage = { limit: 25, offset: 0, total: 0, hasMore: false };
const onePage = { limit: 25, offset: 0, total: 1, hasMore: false };

/** Every self-scoped feed the landing reads, empty unless a test fills one. */
function feeds(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "/api/v1/users/current/votes": { votes: [], page: emptyPage },
    "/api/v1/users/current/forms": { forms: [], page: emptyPage },
    "/api/v1/users/current/organizations": { organizations: [], page: emptyPage },
    "/api/v1/users/current/meetings/series": { series: [], page: emptyPage },
    "/api/v1/users/current/applications": { applications: [], page: emptyPage },
    "/api/v1/events": { events: [], page: emptyPage },
    "/api/v1/users/current/registrations": { registrations: [], page: emptyPage },
    "/api/v1/users/current/proposals": { proposals: [], page: emptyPage },
    "/api/v1/users/current/donations": { donations: [], page: emptyPage },
    ...overrides,
  };
}

/** Routes by pathname so one stub serves all six panels. */
function stubFeeds(bodies: Record<string, unknown>, failing: readonly string[] = []): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), location.origin);
      const path = url.pathname;
      if (path === "/api/v1/events" && url.searchParams.get("phase") === "now") {
        return json(bodies["/api/v1/events?phase=now"] ?? { events: [], page: emptyPage });
      }
      if (failing.includes(path)) return new Response("", { status: 503 });
      const body = bodies[path];
      if (body === undefined) throw new Error(`unexpected request: ${path}`);
      return json(body);
    }),
  );
}

function audienceEventRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "10000000-0000-4000-8000-000000000002",
    slug: "pqc-2026",
    name: "PQC Conference 2026",
    timezone: "UTC",
    startsAt: "2026-12-01T09:00:00.000Z",
    endsAt: "2026-12-01T17:00:00.000Z",
    profileKey: null,
    registrationPolicy: "public",
    visibility: "public",
    accessLevel: "public",
    sponsorLeadAccess: false,
    city: "Amsterdam",
    country: "NL",
    links: [],
    basePath: "/events/pqc-2026",
    viewer: null,
    ...overrides,
  };
}

function meetingSeries(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    seriesId: "40000000-0000-4000-8000-000000000002",
    eventId: "40000000-0000-4000-8000-000000000003",
    groupId: "10000000-0000-4000-8000-000000000001",
    groupName: "Architecture Group",
    eventName: "Monthly sync",
    startsAt: "2026-10-09T13:00:00.000Z",
    recurrenceRule: "FREQ=WEEKLY;INTERVAL=2",
    timezone: "Europe/Amsterdam",
    nextOccurrenceId: "40000000-0000-4000-8000-000000000001",
    nextStartsAt: "2026-10-09T13:00:00.000Z",
    nextEndsAt: "2026-10-09T14:00:00.000Z",
    canJoin: true,
    ...overrides,
  };
}

function organizationRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    organizationId: "50000000-0000-4000-8000-000000000001",
    memberId: "20000000-0000-4000-8000-000000000001",
    name: "Organization A",
    membershipCategory: "A",
    isOrgContact: true,
    isPrimaryContact: true,
    hasPendingReview: false,
    ...overrides,
  };
}

function panelNamed(container: HTMLElement, title: string): HTMLElement {
  const heading = [...container.querySelectorAll("h3")].find((candidate) => candidate.textContent === title);
  const panel = heading?.closest("section");
  if (!panel) throw new Error(`missing panel: ${title}`);
  return panel;
}

afterEach(() => {
  vi.useRealTimers();
  portalSession.value = null;
  profile.value = null;
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
  vi.unstubAllGlobals();
});

describe("portal landing", () => {
  it("adopts the design system at its root and greets the signed-in person by name", async () => {
    portalSession.value = portalSessionFixture({ member: true });
    profile.value = { preferredName: "Robin" } as never;
    stubFeeds(feeds());

    const container = mount();
    await settle();

    const root = container.firstElementChild;
    expect(root?.classList.contains("pk")).toBe(true);
    // A first visit is not a return.
    expect(root?.textContent).toContain("Welcome, Robin.");
    expect(root?.textContent).not.toContain("Welcome back");
    // Nothing in the surface may reach back for the quarantined framework.
    expect(container.innerHTML).not.toMatch(
      /class="[^"]*(?<![-\w])(card|card-body|list-unstyled|text-muted|d-flex)(?![-\w])/,
    );
  });

  it("welcomes the person back only once this device has seen them before", async () => {
    portalSession.value = portalSessionFixture({ member: true });
    profile.value = { preferredName: "Robin" } as never;
    stubFeeds(feeds());
    vi.stubGlobal("localStorage", memoryStorage());

    const first = mount();
    await settle();
    expect(first.textContent).toContain("Welcome, Robin.");

    const second = mount();
    await settle();
    expect(second.textContent).toContain("Welcome back, Robin.");
  });

  it("names every panel as a heading and every list for assistive technology", async () => {
    // The fixture's next meeting is 9 October 13:00 UTC; read it from a week before so it is "next", not "now".
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-02T09:00:00.000Z"));
    portalSession.value = portalSessionFixture({ member: true });
    stubFeeds(
      feeds({
        "/api/v1/users/current/meetings/series": { series: [meetingSeries()], page: onePage },
        "/api/v1/users/current/organizations": { organizations: [organizationRow()], page: onePage },
      }),
    );

    const container = mount();
    await settle();

    const headings = [...container.querySelectorAll("h3")].map((heading) => heading.textContent);
    expect(headings).toEqual(["Upcoming meetings", "Events"]);
    expect([...container.querySelectorAll("h3")].some((heading) => heading.textContent === "Needs your voice")).toBe(
      false,
    );
    expect(container.querySelector('nav[aria-label="Quick links"] a[href="#/groups"]')).not.toBeNull();

    // A list of links with no name is announced as "list"; several of them on
    // one page are indistinguishable.
    const meetings = panelNamed(container, "Upcoming meetings").querySelector("ul");
    expect(meetings?.getAttribute("aria-label")).toBe("Upcoming meetings");
    expect(meetings?.textContent).toContain("Monthly sync");
    expect(meetings?.textContent).toContain("Every other Friday");
    expect(meetings?.textContent).toContain("Next (your time):");
    const personalCalendar = panelNamed(container, "Upcoming meetings").querySelector(
      'a[title="Download the full series calendar (.ics)"]',
    );
    expect(personalCalendar?.getAttribute("aria-label")).toBe("Download the full series calendar (.ics)");
    expect(personalCalendar?.getAttribute("href")).toMatch(/calendar\.ics\?personal=true$/);
    expect(personalCalendar?.classList.contains("pk-btn--ghost")).toBe(true);
    expect(personalCalendar?.classList.contains("pk-btn--icon")).toBe(true);
    expect(personalCalendar?.textContent).toBe("");
    expect(personalCalendar?.querySelector("svg")).not.toBeNull();
    const nextOnly = meetings!.querySelector<HTMLAnchorElement>(
      'a[aria-label="Download only the next meeting (.ics)"]',
    );
    expect(nextOnly?.getAttribute("href")).toContain("occurrenceId=40000000-0000-4000-8000-000000000001");
    expect(nextOnly?.classList.contains("pk-btn--icon")).toBe(true);
    expect(meetings?.textContent).not.toContain("Join meeting");
    const footer = panelNamed(container, "Upcoming meetings").querySelector("footer");
    expect(footer?.textContent).toContain("Do not share");

    const affiliation = container.querySelector(".pk-home-affiliation");
    expect(affiliation?.querySelector('ul[aria-label="Your organizations"] a')?.textContent).toBe("Organization A");
    expect(affiliation?.querySelector("a[href='#/organizations']")).toBeNull();
  });

  it("shows Join only when a meeting is about to start or running", async () => {
    portalSession.value = portalSessionFixture({ member: true });
    const startsSoon = new Date(Date.now() + 10 * 60_000).toISOString();
    const startsLater = new Date(Date.now() + 60 * 60_000).toISOString();
    stubFeeds(
      feeds({
        "/api/v1/users/current/meetings/series": {
          series: [
            meetingSeries({ nextStartsAt: startsSoon, nextEndsAt: new Date(Date.now() + 70 * 60_000).toISOString() }),
            meetingSeries({
              seriesId: "40000000-0000-4000-8000-000000000004",
              nextOccurrenceId: "40000000-0000-4000-8000-000000000005",
              nextStartsAt: startsLater,
              nextEndsAt: new Date(Date.now() + 120 * 60_000).toISOString(),
            }),
          ],
          page: { ...onePage, total: 2 },
        },
      }),
    );

    const container = mount();
    await settle();
    const panel = panelNamed(container, "Upcoming meetings");
    const joins = [...panel.querySelectorAll("a")].filter((link) => link.textContent === "Join meeting");
    expect(joins).toHaveLength(1);
    expect(joins[0].getAttribute("href")).toContain("occurrence=40000000-0000-4000-8000-000000000001");
  });

  it("announces an empty panel through a status region rather than by looking empty", async () => {
    portalSession.value = { ...portalSessionFixture({ member: false }), eventParticipation: true };
    stubFeeds(feeds());

    const container = mount();
    await settle();

    const events = panelNamed(container, "Events");
    const empty = events.querySelector('[role="status"]');
    expect(empty?.textContent).toContain("No current or upcoming events right now.");
    // A non-member sees only the panels that are theirs to see.
    expect(container.querySelectorAll(".pk-home-grid > section h3")).toHaveLength(1);
  });

  it("states a failed feed as a sentence in an alert region instead of an empty panel", async () => {
    portalSession.value = { ...portalSessionFixture({ member: false }), eventParticipation: true };
    stubFeeds(feeds(), ["/api/v1/events"]);

    const container = mount();
    await settle();

    const events = panelNamed(container, "Events");
    const alert = events.querySelector('[role="alert"]');
    expect(alert?.textContent).toBe(
      "Online services are temporarily unavailable. Keep this page open. If you were saving a change, check whether it completed before trying again.",
    );
    // The failure replaces the empty state; the panel must not claim both.
    expect(events.textContent).not.toContain("No current or upcoming events right now.");
  });

  it("lists several events in the order they take place, each once", async () => {
    portalSession.value = { ...portalSessionFixture({ member: false }), eventParticipation: true };
    const later = audienceEventRow({
      id: "10000000-0000-4000-8000-000000000003",
      slug: "later-2027",
      name: "Later Summit",
      startsAt: "2027-03-01T09:00:00.000Z",
      endsAt: "2027-03-01T17:00:00.000Z",
    });
    const soon = audienceEventRow();
    stubFeeds(feeds({ "/api/v1/events": { events: [later, soon], page: onePage } }));

    const container = mount();
    await settle();

    const links = [...panelNamed(container, "Events").querySelectorAll("li a[href^='#/events/']")];
    expect(links.map((link) => link.textContent)).toEqual(["PQC Conference 2026", "Later Summit"]);
  });

  it("renders upcoming events using the shared discovery card", async () => {
    portalSession.value = { ...portalSessionFixture({ member: false }), eventParticipation: true };
    stubFeeds(feeds({ "/api/v1/events": { events: [audienceEventRow()], page: onePage } }));

    const container = mount();
    await settle();

    const events = panelNamed(container, "Events");
    const link = events.querySelector<HTMLAnchorElement>("a[href='#/events/pqc-2026']");
    expect(link?.textContent).toBe("PQC Conference 2026");
    expect(events.textContent).toContain("Amsterdam");
    expect(link?.closest(".event-card")).not.toBeNull();
    expect(events.classList.contains("pk-panel")).toBe(false);
    expect(events.querySelector("ul")?.getAttribute("aria-label")).toBe("Now and next events");
    expect(vi.mocked(fetch).mock.calls.some(([input]) => String(input).includes("kind=standalone"))).toBe(true);
  });

  it("shows a current event and the next event without embedding the events catalog", async () => {
    portalSession.value = { ...portalSessionFixture({ member: false }), eventParticipation: true };
    const at = Date.now();
    stubFeeds(
      feeds({
        "/api/v1/events?phase=now": {
          events: [
            audienceEventRow({
              id: "10000000-0000-4000-8000-000000000003",
              slug: "current",
              name: "Current event",
              startsAt: new Date(at - 60_000).toISOString(),
              endsAt: new Date(at + 60_000).toISOString(),
            }),
          ],
          page: onePage,
        },
        "/api/v1/events": {
          events: [
            audienceEventRow({
              startsAt: new Date(at + 120_000).toISOString(),
              endsAt: new Date(at + 180_000).toISOString(),
            }),
          ],
          page: onePage,
        },
      }),
    );
    const container = mount();
    await settle();
    const events = panelNamed(container, "Events");
    expect(events.querySelectorAll(".event-card")).toHaveLength(2);
    expect(events.querySelectorAll(".event-card-badge")[0]?.textContent).toBe("Happening now");
    expect(events.querySelectorAll(".event-card-badge")[1]?.textContent).toBe("Upcoming");
    expect(events.querySelector('a[href="#/events"]')?.textContent).toBe("More events");
  });

  it("lists an open ballot exactly once on the landing page", async () => {
    portalSession.value = portalSessionFixture({ member: true });
    stubFeeds(
      feeds({
        "/api/v1/users/current/votes": {
          votes: [
            {
              id: "60000000-0000-4000-8000-000000000001",
              slug: "adopt-the-2027-budget",
              title: "Adopt the 2027 budget",
              description: null,
              voteType: "motion",
              ownerGroupId: "10000000-0000-4000-8000-000000000001",
              ownerGroupName: "All Members",
              electorateMode: "per_member",
              thresholdType: "simple_majority",
              questionFormId: null,
              questionForm: null,
              quorumPercent: null,
              tieBreakMode: "none",
              excludedMemberIds: null,
              eligibleCategories: null,
              opensAt: "2026-09-01T00:00:00.000Z",
              closesAt: "2026-09-04T20:00:00.000Z",
              currentRound: 1,
              status: "open",
              cancellationReason: null,
              visibility: "private",
              publicDetailLevel: "outcome_only",
              createdAt: "2026-09-01T00:00:00.000Z",
              updatedAt: "2026-09-01T00:00:00.000Z",
              candidates: null,
              canCastBallot: true,
              hasCastBallot: false,
              memberBallots: null,
              result: null,
            },
          ],
          page: onePage,
        },
      }),
    );

    const container = mount();
    await settle();

    // The vote is a to-do in "Needs your voice" — and nowhere else. A second
    // "Open votes" panel used to repeat the same title a hand's width away.
    const occurrences = container.textContent?.match(/Adopt the 2027 budget/g) ?? [];
    expect(occurrences).toHaveLength(1);
    const attention = panelNamed(container, "Needs your voice");
    expect(attention.textContent).toContain("Vote on: Adopt the 2027 budget");
  });

  it("opens a form shared with one of my groups under that group, not under its owner", async () => {
    portalSession.value = portalSessionFixture({ member: true });
    const placementId = "70000000-0000-4000-8000-000000000001";
    const sharedWithGroupId = "10000000-0000-4000-8000-000000000002";
    stubFeeds(
      feeds({
        "/api/v1/users/current/forms": {
          forms: [
            {
              placementId,
              formId: "70000000-0000-4000-8000-000000000002",
              title: "Workshop feedback",
              purpose: "survey",
              ownerGroupId: "10000000-0000-4000-8000-000000000001",
              ownerGroupName: "Organizing committee",
              accessGroupId: sharedWithGroupId,
              opensAt: null,
              closesAt: "2026-11-15T17:00:00.000Z",
              acceptingResponses: true,
              hasSubmitted: false,
            },
          ],
          page: onePage,
        },
      }),
    );

    const container = mount();
    await settle();

    const link = [...panelNamed(container, "Needs your voice").querySelectorAll("a")].find(
      (anchor) => anchor.textContent === "Respond: Workshop feedback",
    );
    expect(link?.getAttribute("href")).toContain(`/groups/${sharedWithGroupId}/forms/${placementId}`);
    // The asking group and the deadline are separate facts, not "committee closes …".
    expect(link?.parentElement?.textContent).toContain("Organizing committee · closes ");
  });

  it("keeps an organization's standing in words, not in the badge color alone", async () => {
    portalSession.value = portalSessionFixture({ member: true });
    stubFeeds(
      feeds({
        "/api/v1/users/current/organizations": {
          organizations: [
            organizationRow(),
            organizationRow({
              organizationId: "50000000-0000-4000-8000-000000000002",
              name: "Organization B",
              isPrimaryContact: false,
            }),
          ],
          page: { limit: 25, offset: 0, total: 2, hasMore: false },
        },
      }),
    );

    const container = mount();
    await settle();

    const organizations = container.querySelector(".pk-home-affiliation")!;
    const badges = [...organizations.querySelectorAll(".pk-badge")].map((badge) => badge.textContent);
    expect(badges).toEqual(["Primary contact", "Contact"]);
    expect(organizations.querySelector("a[href='#/organizations']")?.textContent).toBe("View all");
  });

  it("lists a pending organization review as a to-do that opens the organization", async () => {
    portalSession.value = portalSessionFixture({ member: true });
    stubFeeds(
      feeds({
        "/api/v1/users/current/organizations": {
          organizations: [organizationRow({ hasPendingReview: true })],
          page: onePage,
        },
      }),
    );

    const container = mount();
    await settle();

    const item = [...panelNamed(container, "Needs your voice").querySelectorAll("a")].find(
      (link) => link.textContent === "Review pending: Organization A",
    );
    expect(item?.getAttribute("href")).toBe("#/organizations/50000000-0000-4000-8000-000000000001");
    // One organization is listed in full, so there is nothing more to view.
    expect(container.querySelector(".pk-home-affiliation")?.textContent).not.toContain("View all");
  });

  it("says an unaffiliated member participates as an individual, and waits on nothing", async () => {
    portalSession.value = portalSessionFixture({ member: true });
    stubFeeds(feeds());

    const container = mount();
    await settle();

    expect(container.querySelector(".pk-home-affiliation")?.textContent).toContain("Participating as an individual");
    expect([...container.querySelectorAll("h3")].some((heading) => heading.textContent === "Needs your voice")).toBe(
      false,
    );
  });
});
