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

    // The record opens with the subject, not with a page title: `ProfileHeader`
    // shows the organization as itself — its mark, its name as the `<h2>`, and
    // what identifies the account under the name. The section carries the name
    // as its accessible name.
    const section = container.querySelector("section");
    expect(section?.getAttribute("aria-label")).toBe("Example Organization");
    const heading = container.querySelector(".pk-profile-header h2");
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
    expect(container.textContent).toContain("1 active representative");

    // The supporting facts sit under the name as one quiet line, the way they
    // do on a contact record — separate entries, so the middots between them
    // are generated and never announced as content.
    const header = container.querySelector(".pk-profile-header");
    const facts = [...(header?.querySelectorAll(".pk-profile-header__facts > li") ?? [])].map(
      (fact) => fact.textContent,
    );
    // Category, when it joined, and how many people act for it — the three
    // facts that identify a member organization, each said once.
    expect(facts).toEqual(["Category F", "Member since Jan 1, 2026", "1 active representative"]);

    // The way back is a trail, so a reader sees where this record sits rather
    // than only that there is a button pointing away from it.
    const trail = container.querySelector('[aria-label="Breadcrumb"]');
    expect(trail?.querySelector("a")?.getAttribute("href")).toBe("#/organizations");
    expect(trail?.querySelector('[aria-current="page"]')?.textContent).toBe("Example Organization");

    // An account page: the people who represent the organization are on the
    // page itself, under the profile; what the account has done across the
    // consortium follows below them, one tab per relation.
    const representatives = container.querySelector('section[aria-label="Representatives"]');
    const activity = container.querySelector('section[aria-label="Activity"]');
    expect(representatives).not.toBeNull();
    expect(activity?.querySelector('[role="tablist"]')).not.toBeNull();
    expect(representatives!.compareDocumentPosition(activity!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("loads the account in bounded queries: the record, its representatives, its sponsorships", async () => {
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
        if (url.pathname.endsWith("/groups")) {
          return json({ groups: [], page: { limit: 25, offset: 0, total: 0, hasMore: false } });
        }
        return json(url.pathname.endsWith("/identities") ? identityPage() : detail());
      }),
    );

    mount(
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
    await waitFor(() => requests.some((request) => request.startsWith("/api/v1/sponsors")));

    expect(requests[0]).toBe(`/api/v1/organizations/${organizationId}`);
    expect(requests.some((request) => request.includes(`/organizations/${organizationId}/identities`))).toBe(true);
    const sponsorRequest = requests.find((request) => request.startsWith("/api/v1/sponsors"));
    expect(sponsorRequest).toContain("visibility=all");
    expect(sponsorRequest).toContain(`organizationId=${organizationId}`);
  });

  it("shows no sponsorships without sponsorships:read, and asks for none", async () => {
    const requests: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        requests.push(url.pathname);
        if (url.pathname.endsWith("/groups")) {
          return json({ groups: [], page: { limit: 25, offset: 0, total: 0, hasMore: false } });
        }
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

    expect(requests.some((request) => request.startsWith("/api/v1/sponsors"))).toBe(false);
    expect([...container.querySelectorAll("caption")].map((caption) => caption.textContent)).not.toContain(
      "Sponsorships",
    );
    expect(container.querySelector('section[aria-label="Representatives"]')).not.toBeNull();
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
