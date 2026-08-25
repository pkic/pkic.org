// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Leadership } from "../../assets/ts/admin/sections/access-control/Leadership";

const mounted: HTMLElement[] = [];
const GROUP_ID = "10000000-0000-4000-8000-000000000001";

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
}

function groupResponse() {
  return {
    groups: [
      {
        id: GROUP_ID,
        slug: "architecture",
        name: "Architecture Committee",
        type: { key: "committee", singularLabel: "Committee", pluralLabel: "Committees" },
        parentGroup: {
          id: "10000000-0000-4000-8000-000000000002",
          slug: "parent",
          name: "Parent Group",
          type: { key: "working_group", singularLabel: "Working Group", pluralLabel: "Working Groups" },
        },
        description: null,
        links: [],
        visibility: "participants",
        governanceInheritanceMode: "inherited",
        eligibilityMode: "managed",
        automaticEnrollmentMode: "none",
        allowAutomaticOptOut: false,
        publicLeadership: false,
        minEndorsersForBallot: 0,
        active: true,
        revision: 0,
        membershipCapacityCount: 2,
        participantCount: 2,
        childCount: 0,
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z",
      },
    ],
    page: { limit: 25, offset: 0, total: 1, hasMore: false },
  };
}

function leadershipResponse() {
  return {
    group: {
      id: GROUP_ID,
      slug: "architecture",
      name: "Architecture Committee",
      type: { key: "committee", singularLabel: "Committee", pluralLabel: "Committees" },
    },
    governanceInheritanceMode: "inherited",
    assignments: [
      {
        userRoleId: "30000000-0000-4000-8000-000000000001",
        userId: "20000000-0000-4000-8000-000000000001",
        userName: "Local Leader",
        email: "local@example.test",
        roleId: "role-group_lead",
        sourceGroup: {
          id: GROUP_ID,
          slug: "architecture",
          name: "Architecture Committee",
          type: { key: "committee", singularLabel: "Committee", pluralLabel: "Committees" },
        },
        inherited: false,
        expiresAt: null,
        createdAt: "2026-08-01T00:00:00.000Z",
      },
      {
        userRoleId: "30000000-0000-4000-8000-000000000002",
        userId: "20000000-0000-4000-8000-000000000002",
        userName: "Parent Deputy",
        email: "parent@example.test",
        roleId: "role-group_deputy_lead",
        sourceGroup: {
          id: "10000000-0000-4000-8000-000000000002",
          slug: "parent",
          name: "Parent Group",
          type: { key: "working_group", singularLabel: "Working Group", pluralLabel: "Working Groups" },
        },
        inherited: true,
        expiresAt: null,
        createdAt: "2026-08-01T00:00:00.000Z",
      },
    ],
  };
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

afterEach(() => {
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
  vi.unstubAllGlobals();
});

describe("generic group leadership admin", () => {
  it("selects any group type and manages local and inherited assignments through canonical group routes", async () => {
    const requests: Array<{ url: URL; method: string }> = [];
    vi.stubGlobal(
      "confirm",
      vi.fn(() => true),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input : input.url,
          location.origin,
        );
        const method = init.method ?? "GET";
        requests.push({ url, method });
        if (url.pathname === "/api/v1/groups") return json(groupResponse());
        if (url.pathname.includes("/leadership-positions")) {
          return json({ positions: [], page: { limit: 25, offset: 0, total: 0, hasMore: false } });
        }
        if (url.pathname === `/api/v1/groups/${GROUP_ID}/leadership`) return json(leadershipResponse());
        if (url.pathname.endsWith("/30000000-0000-4000-8000-000000000001")) {
          return json(leadershipResponse());
        }
        throw new Error(`Unexpected request: ${method} ${url.pathname}`);
      }),
    );

    const container = document.createElement("div");
    document.body.append(container);
    mounted.push(container);
    await act(() => render(<Leadership />, container));
    await settle();

    expect(requests.some(({ url }) => url.pathname === "/api/v1/groups")).toBe(true);
    expect(requests.some(({ url }) => url.pathname.includes("working-groups"))).toBe(false);
    expect(container.textContent).toContain("Architecture Committee");
    expect(container.textContent).toContain("Committee");
    expect(container.textContent).toContain("Parent Group");

    const manage = [...container.querySelectorAll("button")].find((button) => button.textContent === "Manage");
    await act(() => (manage as HTMLButtonElement).click());
    await settle();

    expect(container.textContent).toContain("Local Leader");
    expect(container.textContent).toContain("Parent Deputy");
    expect(container.textContent).toContain("inherited from Parent Group");
    expect([...container.querySelectorAll("button")].filter((button) => button.textContent === "Remove")).toHaveLength(
      1,
    );

    const remove = [...container.querySelectorAll("button")].find((button) => button.textContent === "Remove");
    await act(() => (remove as HTMLButtonElement).click());
    await settle();
    expect(
      requests.some(
        ({ url, method }) =>
          method === "DELETE" &&
          url.pathname === `/api/v1/groups/${GROUP_ID}/leadership/30000000-0000-4000-8000-000000000001`,
      ),
    ).toBe(true);
  });
});
