// @vitest-environment jsdom
import { render, type ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GroupLeadership } from "../../assets/ts/member-flows/portal/sections/management/GroupLeadership";
import { GroupMembers } from "../../assets/ts/member-flows/portal/sections/management/GroupMembers";

const GROUP_ID = "10000000-0000-4000-8000-000000000001";
const MEMBERSHIP_ID = "20000000-0000-4000-8000-000000000001";
const USER_ROLE_ID = "30000000-0000-4000-8000-000000000001";
const mounted: HTMLElement[] = [];

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
}

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

afterEach(() => {
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
  vi.unstubAllGlobals();
});

describe("portal group management resources", () => {
  it("searches and removes exact membership capacities through canonical group routes", async () => {
    const requests: Array<{ url: URL; method: string }> = [];
    let removed = false;
    vi.stubGlobal(
      "confirm",
      vi.fn(() => true),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        const method = init.method ?? "GET";
        requests.push({ url, method });
        if (method === "DELETE") {
          removed = true;
          return json({
            group: {
              id: GROUP_ID,
              slug: "architecture",
              name: "Architecture Committee",
              type: { key: "committee", singularLabel: "Committee", pluralLabel: "Committees" },
            },
            memberships: [],
            endedMembershipIds: [MEMBERSHIP_ID],
          });
        }
        return json({
          memberships: removed
            ? []
            : [
                {
                  id: MEMBERSHIP_ID,
                  groupId: GROUP_ID,
                  userId: "40000000-0000-4000-8000-000000000001",
                  memberId: "50000000-0000-4000-8000-000000000001",
                  memberType: "organization",
                  userName: "Member Person",
                  email: "member@example.test",
                  organizationName: "Member Organization",
                  membershipCategory: "A",
                  source: "staff",
                  createdByUserId: null,
                  joinedAt: "2026-08-01T00:00:00.000Z",
                  leftAt: null,
                },
              ],
          page: { limit: 25, offset: 0, total: removed ? 0 : 1, hasMore: false },
        });
      }),
    );
    const onChanged = vi.fn(async () => {});
    const container = mount(<GroupMembers groupId={GROUP_ID} onChanged={onChanged} />);
    await settle();

    expect(container.textContent).toContain("Member Person");
    expect(container.textContent).toContain("Member Organization");
    const search = container.querySelector<HTMLInputElement>("#managed-group-member-search")!;
    search.value = "member@example.test";
    void act(() => {
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await settle();
    void act(() => {
      search.form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await settle();
    expect(requests.at(-1)?.url.searchParams.get("q")).toBe("member@example.test");

    const remove = [...container.querySelectorAll("button")].find((button) => button.textContent === "Remove")!;
    await act(async () => remove.click());
    await settle();
    expect(
      requests.some(
        ({ url, method }) =>
          method === "DELETE" && url.pathname === `/api/v1/groups/${GROUP_ID}/memberships/${MEMBERSHIP_ID}`,
      ),
    ).toBe(true);
    expect(onChanged).toHaveBeenCalledOnce();
  });

  it("distinguishes inherited leadership and removes only local assignments", async () => {
    const requests: Array<{ url: URL; method: string }> = [];
    vi.stubGlobal(
      "confirm",
      vi.fn(() => true),
    );
    const leadership = {
      group: {
        id: GROUP_ID,
        slug: "architecture",
        name: "Architecture Committee",
        type: { key: "committee", singularLabel: "Committee", pluralLabel: "Committees" },
      },
      governanceInheritanceMode: "inherited",
      assignments: [
        {
          userRoleId: USER_ROLE_ID,
          userId: "40000000-0000-4000-8000-000000000001",
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
          userId: "40000000-0000-4000-8000-000000000002",
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
    } as const;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        requests.push({ url, method: init.method ?? "GET" });
        return json(leadership);
      }),
    );
    const container = mount(<GroupLeadership groupId={GROUP_ID} />);
    await settle();

    expect(container.textContent).toContain("inherited from Parent Group");
    const removeButtons = [...container.querySelectorAll("button")].filter((button) => button.textContent === "Remove");
    expect(removeButtons).toHaveLength(1);
    await act(async () => removeButtons[0].click());
    await settle();
    expect(
      requests.some(
        ({ url, method }) =>
          method === "DELETE" && url.pathname === `/api/v1/groups/${GROUP_ID}/leadership/${USER_ROLE_ID}`,
      ),
    ).toBe(true);
  });
});
