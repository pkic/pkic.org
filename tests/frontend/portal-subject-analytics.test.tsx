// @vitest-environment jsdom
/**
 * The membership, organization and user analytics pages each name themselves
 * and read their own bounded projection; the figures are the server's.
 */
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  membershipAnalyticsResponseSchema,
  organizationAnalyticsResponseSchema,
  userAnalyticsResponseSchema,
} from "../../assets/shared/schemas/analytics";
import {
  MembershipAnalytics,
  OrganizationAnalytics,
  UserAnalytics,
} from "../../assets/ts/member-flows/portal/sections/system-analytics/SubjectAnalyticsPages";

let container: HTMLDivElement | null = null;

const generatedAt = "2026-09-22T12:00:00.000Z";
const joinedMonthly = [{ month: "2026-08", count: 3 }];

afterEach(() => {
  if (container) {
    void act(() => render(null, container!));
    container.remove();
    container = null;
  }
  vi.unstubAllGlobals();
});

async function open(page: () => preact.VNode, path: string, body: unknown): Promise<string[]> {
  const paths: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
        location.origin,
      );
      paths.push(url.pathname);
      if (url.pathname !== path) throw new Error(`Unexpected request: ${url.pathname}`);
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    }),
  );
  container = document.createElement("div");
  document.body.append(container);
  await act(() => render(page(), container!));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return paths;
}

describe("subject analytics pages", () => {
  it("reads the members projection and names its category rows", async () => {
    const paths = await open(
      () => <MembershipAnalytics />,
      "/api/v1/analytics/members",
      membershipAnalyticsResponseSchema.parse({
        generatedAt,
        members: {
          total: 1234,
          byStatus: { active: 1200, lapsed: 34 },
          byKind: { organization: 900, individual: 334 },
          byCategory: [{ code: "F", label: "Full", count: 900 }],
          representation: { withRepresentatives: 1100, withoutRepresentatives: 134 },
          joinedMonthly,
        },
      }),
    );

    expect(paths).toEqual(["/api/v1/analytics/members"]);
    expect(container!.querySelector("h2")?.textContent).toBe("Membership analytics");
    expect(container!.textContent).toContain("Memberships begun, by month");
    expect(container!.textContent).toContain("Full (F)");
  });

  it("reads the organizations projection and shows its monthly series", async () => {
    const paths = await open(
      () => <OrganizationAnalytics />,
      "/api/v1/analytics/organizations",
      organizationAnalyticsResponseSchema.parse({
        generatedAt,
        organizations: {
          total: 2500,
          members: 900,
          recordedOnly: 1600,
          withRepresentatives: 800,
          withoutRepresentatives: 100,
          withLogo: 700,
          withWebsite: 2000,
          createdMonthly: joinedMonthly,
        },
      }),
    );

    expect(paths).toEqual(["/api/v1/analytics/organizations"]);
    expect(container!.querySelector("h2")?.textContent).toBe("Organization analytics");
    expect(container!.textContent).toContain("Organizations recorded, by month");
    expect(container!.textContent).toContain("recorded only");
  });

  it("reads the users projection and shows its monthly series", async () => {
    const paths = await open(
      () => <UserAnalytics />,
      "/api/v1/analytics/users",
      userAnalyticsResponseSchema.parse({
        generatedAt,
        users: {
          total: 4321,
          active: 4000,
          inactive: 321,
          byRole: { member: 4000 },
          withIdentities: 3000,
          withoutIdentities: 1321,
          createdMonthly: joinedMonthly,
        },
      }),
    );

    expect(paths).toEqual(["/api/v1/analytics/users"]);
    expect(container!.querySelector("h2")?.textContent).toBe("User analytics");
    expect(container!.textContent).toContain("Accounts created, by month");
  });
});
