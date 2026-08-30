// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SelfGroup } from "../../assets/shared/schemas/group-participation";
import { GroupParticipationCard } from "../../assets/ts/member-flows/portal/sections/GroupParticipationCard";
import { Groups } from "../../assets/ts/member-flows/portal/sections/Groups";
import { portalSession } from "../../assets/ts/member-flows/portal/state";
import { portalSessionFixture } from "../helpers/portal-session";

vi.mock("wouter/use-hash-location", () => ({
  useHashLocation: () => ["/groups", vi.fn()],
}));

const mounted: HTMLElement[] = [];

function group(overrides: Partial<SelfGroup> = {}): SelfGroup {
  return {
    id: "10000000-0000-4000-8000-000000000001",
    slug: "architecture",
    name: "Architecture Group",
    type: { key: "working_group", singularLabel: "Working group", pluralLabel: "Working groups" },
    parentGroup: null,
    description: "Architecture collaboration",
    links: [],
    visibility: "public",
    governanceInheritanceMode: "inherited",
    eligibilityMode: "open",
    automaticEnrollmentMode: "none",
    allowAutomaticOptOut: false,
    publicLeadership: false,
    minEndorsersForBallot: 0,
    active: true,
    revision: 0,
    membershipCapacityCount: 0,
    participantCount: 0,
    childCount: 0,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    eligibleCapacities: [
      {
        memberId: "20000000-0000-4000-8000-000000000001",
        memberType: "organization",
        organizationName: "Organization A",
        membershipCategory: "A",
      },
      {
        memberId: "20000000-0000-4000-8000-000000000002",
        memberType: "organization",
        organizationName: "Organization B",
        membershipCategory: "B",
      },
    ],
    memberships: [],
    ...overrides,
  };
}

function mountCard(value: SelfGroup, onChanged = vi.fn(async () => {})): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  mounted.push(container);
  void act(() => render(<GroupParticipationCard group={value} onChanged={onChanged} />, container));
  return container;
}

function mountGroups(): HTMLElement {
  portalSession.value = portalSessionFixture({ member: true });
  const container = document.createElement("div");
  document.body.append(container);
  mounted.push(container);
  void act(() => render(<Groups />, container));
  return container;
}

function mutationResponse() {
  return new Response(
    JSON.stringify({
      group: {
        id: "10000000-0000-4000-8000-000000000001",
        slug: "architecture",
        name: "Architecture Group",
        type: { key: "working_group", singularLabel: "Working group", pluralLabel: "Working groups" },
      },
      memberships: [],
      endedMembershipIds: [],
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

afterEach(() => {
  portalSession.value = null;
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
  vi.unstubAllGlobals();
});

describe("generic group participation card", () => {
  it("loads every configured group type without a working-group filter", async () => {
    let request: URL | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        request = new URL(String(input), location.origin);
        return new Response(
          JSON.stringify({
            groups: [
              group({
                type: { key: "committee", singularLabel: "Committee", pluralLabel: "Committees" },
                parentGroup: {
                  id: "10000000-0000-4000-8000-000000000002",
                  slug: "parent-group",
                  name: "Parent Group",
                  type: { key: "working_group", singularLabel: "Working group", pluralLabel: "Working groups" },
                },
              }),
            ],
            page: { limit: 25, offset: 0, total: 1, hasMore: false },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }),
    );

    const container = mountGroups();
    await settle();

    expect(request?.pathname).toBe("/api/v1/users/current/groups");
    expect(request?.searchParams.get("view")).toBe("catalog");
    expect(request?.searchParams.has("typeKey")).toBe(false);
    expect(container.textContent).toContain("Committee");
    expect(container.textContent).toContain("Part of Parent Group");
  });

  it("selects every represented organization by default", async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        requests.push({ url: String(input), init });
        return mutationResponse();
      }),
    );
    const container = mountCard(group());
    const checkboxes = [...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
    expect(checkboxes).toHaveLength(2);
    expect(checkboxes.every((checkbox) => checkbox.checked)).toBe(true);

    void act(() => (container.querySelector("button.btn-outline-primary") as HTMLButtonElement).click());
    await settle();
    expect(requests[0]?.url).toBe("/api/v1/groups/10000000-0000-4000-8000-000000000001/join");
    expect(JSON.parse(String(requests[0]?.init.body))).toEqual({
      capacitySelection: { mode: "all_eligible", confirmed: true },
    });
  });

  it("sends an explicit subset after the user clears one affiliation", async () => {
    let body: unknown;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init: RequestInit = {}) => {
        body = JSON.parse(String(init.body));
        return mutationResponse();
      }),
    );
    const container = mountCard(group());
    const checkboxes = [...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
    void act(() => checkboxes[1]!.click());
    void act(() => (container.querySelector("button.btn-outline-primary") as HTMLButtonElement).click());
    await settle();
    expect(body).toEqual({
      capacitySelection: {
        mode: "selected",
        memberIds: ["20000000-0000-4000-8000-000000000001"],
      },
    });
  });

  it("adds and removes individual organization capacities without leaving the group", async () => {
    const requests: Array<{ url: string; body: unknown }> = [];
    vi.stubGlobal(
      "confirm",
      vi.fn(() => true),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        requests.push({ url: String(input), body: JSON.parse(String(init.body)) });
        return mutationResponse();
      }),
    );
    const container = mountCard(
      group({
        memberships: [
          {
            id: "30000000-0000-4000-8000-000000000001",
            memberId: "20000000-0000-4000-8000-000000000001",
            memberType: "organization",
            organizationName: "Organization A",
            membershipCategory: "A",
            source: "self_service",
            joinedAt: "2026-08-20T00:00:00.000Z",
          },
        ],
      }),
    );

    expect(container.querySelector<HTMLAnchorElement>("a")?.getAttribute("href")).toBe(
      "#/groups/10000000-0000-4000-8000-000000000001/meetings",
    );

    void act(() => (container.querySelector("button.btn-outline-primary") as HTMLButtonElement).click());
    await settle();
    expect(requests[0]).toEqual({
      url: "/api/v1/groups/10000000-0000-4000-8000-000000000001/join",
      body: {
        capacitySelection: {
          mode: "selected",
          memberIds: ["20000000-0000-4000-8000-000000000002"],
        },
      },
    });

    void act(() => (container.querySelector("button.btn-outline-danger") as HTMLButtonElement).click());
    await settle();
    expect(requests[1]).toEqual({
      url: "/api/v1/groups/10000000-0000-4000-8000-000000000001/leave",
      body: { mode: "selected", memberIds: ["20000000-0000-4000-8000-000000000001"] },
    });
  });
});
