// @vitest-environment jsdom
/**
 * The system organization record's shell.
 *
 * `portal-system-organizations.test.tsx` covers what the record can be edited
 * into; this covers the frame around it — the heading the section is named by,
 * and what the surface says when the record cannot be loaded at all.
 */
import { render, type ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { organizationDetailResponseSchema } from "../../assets/shared/schemas/organization-management";
import { identitiesListResponseSchema } from "../../assets/shared/schemas/identity";
import { OrganizationDetail } from "../../assets/ts/member-flows/portal/sections/system-organizations/OrganizationDetail";

vi.mock("wouter/use-hash-location", () => ({ useHashLocation: () => ["/organizations", vi.fn()] }));

const mounted: HTMLElement[] = [];
const organizationId = "00000000-0000-4000-8000-000000000010";
const userId = "00000000-0000-4000-8000-000000000011";
const identityId = "00000000-0000-4000-8000-000000000012";
const membershipId = "00000000-0000-4000-8000-000000000013";

function mount(node: ComponentChildren): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  mounted.push(container);
  void act(() => render(node, container));
  return container;
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** Settles until `condition` holds, failing after a bounded budget. */
async function waitFor(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (condition()) return;
    await settle();
  }
  throw new Error("Expected condition was not met.");
}

/** Selects one of the record's facets the way a reader does: by its tab. */
async function openTab(container: HTMLElement, name: string): Promise<void> {
  await waitFor(() =>
    [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')].some(
      (candidate) => candidate.textContent === name,
    ),
  );
  const tab = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
    (candidate) => candidate.textContent === name,
  );
  await act(async () => tab?.click());
}

function detail() {
  return organizationDetailResponseSchema.parse({
    organization: {
      id: organizationId,
      name: "Example Organization",
      membershipCategory: "F",
      memberSince: "2026-01-01",
      activeIdentityCount: 1,
      primaryContactName: "Ada Lovelace",
      primaryContactEmail: "ada@example.test",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      website: "https://example.test",
      description: "Example description",
      slogan: null,
      logoUrl: null,
      contentMarkdown: null,
      blogUrl: null,
      blogFeedUrl: null,
      pressUrl: null,
      pressFeedUrl: null,
      careersUrl: null,
      links: [],
      primaryContactUserId: userId,
      secondaryContactUserId: null,
      identities: [
        {
          identityId,
          membershipId,
          userId,
          name: "Ada Lovelace",
          emailId: null,
          email: "ada@example.test",
          headshotUrl: null,
          jobTitle: "Engineer",
          biography: null,
          links: [],
          state: "active",
          showOnOrgProfile: true,
          isPrimaryContact: true,
          isSecondaryContact: false,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    },
  });
}

function identityPage() {
  return identitiesListResponseSchema.parse({
    identities: [],
    page: { limit: 25, offset: 0, total: 0, hasMore: false },
  });
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

afterEach(() => {
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
  vi.unstubAllGlobals();
});

describe("organization detail shell", () => {
  it("opens with one statement of the record: trail, heading, and badges, each said once", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        return Promise.resolve(json(url.pathname.endsWith("/identities") ? identityPage() : detail()));
      }),
    );

    const container = mount(
      <OrganizationDetail
        organizationId={organizationId}
        canRead
        canWrite={false}
        canManageIdentities={false}
        canReadSponsorships={false}
      />,
    );
    await settle();
    await settle();

    // The record opens with a PageHeader: the name is the page's `<h2>`, and
    // the section carries it as its accessible name.
    const section = container.querySelector("section");
    expect(section?.getAttribute("aria-label")).toBe("Example Organization");
    const heading = container.querySelector(".pk-page-header h2");
    expect(heading?.textContent).toBe("Example Organization");

    // One name, once: no kicker restating what the trail already says, and no
    // second heading repeating the section's name above the record.
    expect(container.querySelector(".pk-kicker")).toBeNull();
    expect(
      [...container.querySelectorAll("h1, h2, h3, h4, h5")].filter(
        (candidate) => candidate.textContent === "Organization" || candidate.textContent === "Organizations",
      ),
    ).toEqual([]);

    // The identity count reads as a sentence rather than a bare number, and
    // the singular is not "1 identities".
    expect(container.textContent).toContain("1 active identity");

    // The heading's supporting facts are badges beside the name rather than a
    // line of small text above everything. The membership category is stated
    // here, and only here, so the record's own list does not repeat it.
    const header = container.querySelector("header");
    const badges = [...(header?.querySelectorAll(".pk-badge") ?? [])].map((badge) => badge.textContent);
    expect(badges).toEqual(["Category F", "1 active identity"]);

    // The way back is a trail, so a reader sees where this record sits rather
    // than only that there is a button pointing away from it.
    const trail = container.querySelector('[aria-label="Breadcrumb"]');
    expect(trail?.querySelector("a")?.getAttribute("href")).toBe("#/organizations");
    expect(trail?.querySelector('[aria-current="page"]')?.textContent).toBe("Example Organization");

    // The record's facets are tabs under the header, not one long scroll.
    const tablist = container.querySelector('[role="tablist"]');
    expect(tablist).not.toBeNull();
  });

  it("fetches each facet only when its tab is selected", async () => {
    const requests: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        requests.push(url.pathname + url.search);
        if (url.pathname === "/api/v1/sponsors") {
          return json({ sponsorships: [], page: { limit: 25, offset: 0, total: 0, hasMore: false } });
        }
        return json(url.pathname.endsWith("/identities") ? identityPage() : detail());
      }),
    );

    const container = mount(
      <OrganizationDetail
        organizationId={organizationId}
        canRead
        canWrite={false}
        canManageIdentities
        canReadSponsorships
      />,
    );
    await settle();
    await settle();

    // First paint loads the record itself, and nothing else: a tab is the
    // license not to fetch a facet nobody is looking at.
    expect(requests).toEqual([`/api/v1/organizations/${organizationId}`]);

    await openTab(container, "Identities");
    await waitFor(() => requests.some((request) => request.includes(`/organizations/${organizationId}/identities`)));
    expect(requests.some((request) => request.startsWith("/api/v1/sponsors"))).toBe(false);

    await openTab(container, "Sponsorships");
    await waitFor(() => requests.some((request) => request.startsWith("/api/v1/sponsors")));
    const sponsorRequest = requests.find((request) => request.startsWith("/api/v1/sponsors"));
    expect(sponsorRequest).toContain("visibility=all");
    expect(sponsorRequest).toContain(`organizationId=${organizationId}`);
  });

  it("offers no sponsorships tab without sponsorships:read", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        return json(url.pathname.endsWith("/identities") ? identityPage() : detail());
      }),
    );

    const container = mount(
      <OrganizationDetail
        organizationId={organizationId}
        canRead
        canWrite={false}
        canManageIdentities={false}
        canReadSponsorships={false}
      />,
    );
    await settle();
    await settle();

    const tabNames = [...container.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent);
    expect(tabNames).toEqual(["Overview", "Identities"]);
  });

  it("announces a failed load as an alert instead of an empty record", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("organization unavailable", { status: 503 }))),
    );

    const container = mount(
      <OrganizationDetail
        organizationId={organizationId}
        canRead
        canWrite={false}
        canManageIdentities={false}
        canReadSponsorships={false}
      />,
    );
    await settle();

    const alert = container.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert?.textContent).not.toBe("");
    expect(container.querySelector("section")).toBeNull();
  });

  it("says which permission is missing rather than showing a blank record", () => {
    const container = mount(
      <OrganizationDetail
        organizationId={organizationId}
        canRead={false}
        canWrite={false}
        canManageIdentities={false}
        canReadSponsorships={false}
      />,
    );

    expect(container.querySelector('[role="alert"]')?.textContent).toContain("organizations:read");
  });
});
