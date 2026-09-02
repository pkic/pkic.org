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
    "/api/v1/users/current/meetings": { occurrences: [], page: emptyPage },
    "/api/v1/users/current/applications": { applications: [], page: emptyPage },
    "/api/v1/events": { events: [], page: emptyPage },
    ...overrides,
  };
}

/** Routes by pathname so one stub serves all six panels. */
function stubFeeds(bodies: Record<string, unknown>, failing: readonly string[] = []): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input), location.origin).pathname;
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
    location: "Amsterdam",
    links: [],
    basePath: "/events/pqc-2026",
    viewer: null,
    ...overrides,
  };
}

function meetingOccurrence(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    occurrenceId: "40000000-0000-4000-8000-000000000001",
    seriesId: "40000000-0000-4000-8000-000000000002",
    eventId: "40000000-0000-4000-8000-000000000003",
    groupId: "10000000-0000-4000-8000-000000000001",
    groupName: "Architecture Group",
    eventName: "Monthly sync",
    startsAt: "2026-09-10T13:00:00.000Z",
    endsAt: "2026-09-10T14:00:00.000Z",
    status: "scheduled",
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
    expect(root?.textContent).toContain("Welcome back, Robin.");
    // Nothing in the surface may reach back for the quarantined framework.
    expect(container.innerHTML).not.toMatch(/class="[^"]*\b(card|card-body|list-unstyled|text-muted|d-flex)\b/);
  });

  it("names every panel as a heading and every list for assistive technology", async () => {
    portalSession.value = portalSessionFixture({ member: true });
    stubFeeds(
      feeds({
        "/api/v1/users/current/meetings": { occurrences: [meetingOccurrence()], page: onePage },
        "/api/v1/users/current/organizations": { organizations: [organizationRow()], page: onePage },
      }),
    );

    const container = mount();
    await settle();

    const headings = [...container.querySelectorAll("h3")].map((heading) => heading.textContent);
    expect(headings).toEqual(["Needs your voice", "Upcoming meetings", "Upcoming events", "Your organizations"]);

    // A list of links with no name is announced as "list"; several of them on
    // one page are indistinguishable.
    const meetings = panelNamed(container, "Upcoming meetings").querySelector("ul");
    expect(meetings?.getAttribute("aria-label")).toBe("Upcoming meetings");
    expect(meetings?.textContent).toContain("Monthly sync");

    // The "View all" affordance is a real link, not a click handler on a span.
    const viewAll = panelNamed(container, "Your organizations").querySelector("a[href='#/organizations']");
    expect(viewAll?.textContent).toBe("View all");
  });

  it("announces an empty panel through a status region rather than by looking empty", async () => {
    portalSession.value = portalSessionFixture({ member: false });
    stubFeeds(feeds());

    const container = mount();
    await settle();

    const events = panelNamed(container, "Upcoming events");
    const empty = events.querySelector('[role="status"]');
    expect(empty?.textContent).toContain("No upcoming events right now.");
    // A non-member sees only the panels that are theirs to see.
    expect(container.querySelectorAll("h3")).toHaveLength(1);
  });

  it("states a failed feed as a sentence in an alert region instead of an empty panel", async () => {
    portalSession.value = portalSessionFixture({ member: false });
    stubFeeds(feeds(), ["/api/v1/events"]);

    const container = mount();
    await settle();

    const events = panelNamed(container, "Upcoming events");
    const alert = events.querySelector('[role="alert"]');
    expect(alert?.textContent).toBe("The service is temporarily unavailable. Try again in a moment.");
    // The failure replaces the empty state; the panel must not claim both.
    expect(events.textContent).not.toContain("No upcoming events right now.");
  });

  it("renders an upcoming event as a link with its schedule and place beside it", async () => {
    portalSession.value = portalSessionFixture({ member: false });
    stubFeeds(feeds({ "/api/v1/events": { events: [audienceEventRow()], page: onePage } }));

    const container = mount();
    await settle();

    const events = panelNamed(container, "Upcoming events");
    const link = events.querySelector<HTMLAnchorElement>("a[href='/events/pqc-2026']");
    expect(link?.textContent).toBe("PQC Conference 2026");
    expect(events.textContent).toContain("Amsterdam");
    expect(events.querySelector("ul")?.getAttribute("aria-label")).toBe("Upcoming events");
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

  it("keeps an organization's standing in words, not in the badge colour alone", async () => {
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

    const organizations = panelNamed(container, "Your organizations");
    const badges = [...organizations.querySelectorAll(".pk-badge")].map((badge) => badge.textContent);
    expect(badges).toEqual(["Primary contact", "Contact"]);
  });
});
