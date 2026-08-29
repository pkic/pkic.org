// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { myProfileSchema } from "../../assets/shared/schemas/me";
import { MyOrganization } from "../../assets/ts/member-flows/portal/sections/MyOrganization";
import { profile } from "../../assets/ts/member-flows/portal/state";

const organizationId = "00000000-0000-4000-8000-000000000210";
const userId = "00000000-0000-4000-8000-000000000211";
const memberId = "00000000-0000-4000-8000-000000000212";

let container: HTMLDivElement;

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  profile.value = myProfileSchema.parse({
    userId,
    email: "contact@example.test",
    firstName: "Contact",
    lastName: "Person",
    preferredName: null,
    jobTitle: null,
    biography: null,
    links: [],
    membershipCategory: "F",
    organizationId,
    organizationName: "Example Organization",
    memberSince: "2026-01-01",
    showOnOrgProfile: true,
    headshotUrl: null,
    canEditOrganizationName: false,
    isOrgContact: true,
    organizationRepresentatives: [],
    activeMemberships: [
      { memberId, organizationId, organizationName: "Example Organization", membershipCategory: "F" },
    ],
  });
});

afterEach(() => {
  void act(() => render(null, container));
  container.remove();
  profile.value = null;
  vi.unstubAllGlobals();
});

describe("portal organization self-service", () => {
  it("loads only explicit organization resource paths", async () => {
    const requests: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        requests.push(url.pathname);
        if (url.pathname === `/api/v1/organizations/${organizationId}/profile`) {
          return json({
            organization: {
              id: organizationId,
              name: "Example Organization",
              website: "https://example.test",
              description: "Example profile",
              slogan: null,
              logoUrl: null,
              contentMarkdown: null,
              blogUrl: null,
              blogFeedUrl: null,
              pressUrl: null,
              pressFeedUrl: null,
              careersUrl: null,
              links: [],
              isOrgContact: true,
              isPrimaryContact: true,
              pendingSecondaryContactUserId: null,
              pendingReview: null,
            },
          });
        }
        if (url.pathname === `/api/v1/organizations/${organizationId}/content/reviews`) {
          return json({ reviews: [], page: { limit: 25, offset: 0, total: 0, hasMore: false } });
        }
        if (url.pathname === `/api/v1/organizations/${organizationId}/sponsorships/current`) {
          return json({ sponsorship: { tier: null, startDate: null } });
        }
        throw new Error(`Unexpected request: ${url.pathname}`);
      }),
    );

    void act(() => render(<MyOrganization />, container));
    await settle();

    expect(container.textContent).toContain("Example Organization");
    expect(requests).toEqual(
      expect.arrayContaining([
        `/api/v1/organizations/${organizationId}/profile`,
        `/api/v1/organizations/${organizationId}/content/reviews`,
        `/api/v1/organizations/${organizationId}/sponsorships/current`,
      ]),
    );
    expect(requests.some((path) => path.startsWith("/api/v1/me"))).toBe(false);
  });
});
