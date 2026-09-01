// @vitest-environment jsdom
/**
 * The identity's participation record. Every panel is a bounded self-scoped
 * server page, so the three states a panel can be in — loading, failed,
 * empty — matter more than any one row's copy, and each has to be announced
 * rather than merely drawn. Which panels exist at all is a capacity decision:
 * votes and membership applications belong to a member identity.
 */
import { render, type ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { currentUserDonationsListResponseSchema } from "../../assets/shared/schemas/current-user-donations";
import { currentUserProposalsListResponseSchema } from "../../assets/shared/schemas/current-user-proposals";
import { currentUserRegistrationsListResponseSchema } from "../../assets/shared/schemas/current-user-registrations";
import { myApplicationsListResponseSchema } from "../../assets/shared/schemas/me";
import { currentUserVotesListResponseSchema } from "../../assets/shared/schemas/votes";
import { Participation } from "../../assets/ts/member-flows/portal/sections/Participation";
import { portalSession } from "../../assets/ts/member-flows/portal/state";
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
  void act(() => render(<Participation />, container));
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

const REGISTRATION = {
  id: "30000000-0000-4000-8000-000000000001",
  event: {
    id: "10000000-0000-4000-8000-000000000002",
    slug: "pqc-2026",
    name: "PQC Conference 2026",
    startsAt: "2026-12-01T09:00:00.000Z",
    endsAt: "2026-12-01T17:00:00.000Z",
    timezone: "UTC",
  },
  status: "registered",
  attendanceType: "in_person",
  waitlisted: false,
  createdAt: "2026-08-01T09:00:00.000Z",
};

const PROPOSAL = {
  id: "60000000-0000-4000-8000-000000000001",
  event: { id: "10000000-0000-4000-8000-000000000002", slug: "pqc-2026", name: "PQC Conference 2026" },
  title: "Rotating a root in production",
  status: "under_review",
  role: "submitter",
  updatedAt: "2026-08-10T09:00:00.000Z",
};

const DONATION = {
  id: "70000000-0000-4000-8000-000000000001",
  grossAmount: 25_000,
  currency: "USD",
  status: "completed",
  source: null,
  createdAt: "2026-07-04T09:00:00.000Z",
};

/**
 * Every self-scoped feed the record reads, empty unless a test fills one, and
 * each parsed through its own shared response contract so a fixture that
 * drifts from the API shape fails here rather than rendering something the
 * server could never send.
 */
function feeds(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "/api/v1/users/current/registrations": currentUserRegistrationsListResponseSchema.parse({
      registrations: [],
      page: emptyPage,
    }),
    "/api/v1/users/current/proposals": currentUserProposalsListResponseSchema.parse({
      proposals: [],
      page: emptyPage,
    }),
    "/api/v1/users/current/donations": currentUserDonationsListResponseSchema.parse({
      donations: [],
      page: emptyPage,
    }),
    "/api/v1/users/current/votes": currentUserVotesListResponseSchema.parse({ votes: [], page: emptyPage }),
    "/api/v1/users/current/applications": myApplicationsListResponseSchema.parse({
      applications: [],
      page: emptyPage,
    }),
    ...overrides,
  };
}

/** Routes by pathname so one stub serves every panel. */
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

function panelNamed(container: HTMLElement, title: string): HTMLElement {
  const heading = [...container.querySelectorAll("h3")].find((candidate) => candidate.textContent === title);
  const panel = heading?.closest("section");
  if (!panel) throw new Error(`missing panel: ${title}`);
  return panel;
}

afterEach(() => {
  portalSession.value = null;
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
  vi.unstubAllGlobals();
});

describe("portal participation record", () => {
  it("adopts the design system at its root and keeps the quarantined framework out of the markup", async () => {
    portalSession.value = portalSessionFixture({ member: true });
    stubFeeds(feeds());

    const container = mount();
    await settle();

    const root = container.firstElementChild;
    expect(root?.classList.contains("pk")).toBe(true);
    // Whole class tokens only: `pk-small` is ours, and a plain `\b` would
    // read the hyphen as a boundary and flag it.
    expect(container.innerHTML).not.toMatch(
      /class="[^"]*(?<![-\w])(card|card-body|card-header|list-unstyled|text-muted|small|d-flex|fw-semibold)(?![-\w])/,
    );
  });

  it("names every record panel as a heading and every list for assistive technology", async () => {
    portalSession.value = portalSessionFixture({ member: true });
    stubFeeds(
      feeds({
        "/api/v1/users/current/registrations": currentUserRegistrationsListResponseSchema.parse({
          registrations: [REGISTRATION],
          page: onePage,
        }),
      }),
    );

    const container = mount();
    await settle();

    expect([...container.querySelectorAll("h3")].map((heading) => heading.textContent)).toEqual([
      "Event registrations",
      "Votes",
      "Event proposals",
      "Donations",
      "Membership applications",
    ]);

    // Five lists on one page are indistinguishable if none of them is named.
    const list = panelNamed(container, "Event registrations").querySelector("ul");
    expect(list?.getAttribute("aria-label")).toBe("Event registrations");
    expect(list?.textContent).toContain("PQC Conference 2026");
    // Status arrives as words, not as a tone the reader has to interpret.
    expect(list?.textContent).toContain("Registered");
    expect(list?.textContent).toContain("In person");
  });

  it("announces an empty record through a status region rather than by looking empty", async () => {
    portalSession.value = portalSessionFixture({ member: true });
    stubFeeds(feeds());

    const container = mount();
    await settle();

    const donations = panelNamed(container, "Donations");
    const empty = donations.querySelector('[role="status"]');
    expect(empty?.textContent).toContain("No donations recorded for your verified email.");
    expect(donations.querySelector("ul")).toBeNull();
  });

  it("states a failed feed as a sentence in an alert region, leaving the other records readable", async () => {
    portalSession.value = portalSessionFixture({ member: true });
    stubFeeds(feeds(), ["/api/v1/users/current/proposals"]);

    const container = mount();
    await settle();

    const proposals = panelNamed(container, "Event proposals");
    const alert = proposals.querySelector('[role="alert"]');
    expect(alert?.textContent).toBe("The service is temporarily unavailable. Try again in a moment.");
    // The raw transport phrasing never reaches the reader.
    expect(proposals.textContent).not.toContain("HTTP 503");
    // One failed panel does not take the rest of the record down with it.
    expect(panelNamed(container, "Donations").querySelector('[role="alert"]')).toBeNull();
  });

  it("shows an identity with no member capacity only the records that are theirs", async () => {
    portalSession.value = portalSessionFixture({ staff: true });
    stubFeeds(
      feeds({
        "/api/v1/users/current/proposals": currentUserProposalsListResponseSchema.parse({
          proposals: [PROPOSAL],
          page: onePage,
        }),
        "/api/v1/users/current/donations": currentUserDonationsListResponseSchema.parse({
          donations: [DONATION],
          page: onePage,
        }),
      }),
    );

    const container = mount();
    await settle();

    expect([...container.querySelectorAll("h3")].map((heading) => heading.textContent)).toEqual([
      "Event registrations",
      "Event proposals",
      "Donations",
    ]);
    expect(panelNamed(container, "Event proposals").textContent).toContain("Rotating a root in production");
    expect(panelNamed(container, "Donations").textContent).toContain("USD 250.00");
  });
});
