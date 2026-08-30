// @vitest-environment jsdom
import { render, type ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfirmDialogHost } from "../../assets/ts/components/ConfirmDialog";
import { GroupLeadership } from "../../assets/ts/member-flows/portal/sections/management/GroupLeadership";
import { GroupLeadershipAssignmentForm } from "../../assets/ts/member-flows/portal/sections/management/GroupLeadershipAssignmentForm";

const navigate = vi.fn();

vi.mock("wouter/use-hash-location", () => ({
  useHashLocation: () => ["", navigate],
}));

const GROUP_ID = "10000000-0000-4000-8000-000000000001";
const USER_ROLE_ID = "30000000-0000-4000-8000-000000000001";
const MEMBER_ID = "20000000-0000-4000-8000-000000000001";
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

async function openRowMenu(container: HTMLElement, ariaLabel: string): Promise<void> {
  const trigger = container.querySelector<HTMLButtonElement>(`button[aria-label="${ariaLabel}"]`);
  if (!trigger) throw new Error(`missing row menu trigger: ${ariaLabel}`);
  await act(() => trigger.click());
}

function menuItem(container: HTMLElement, label: string): HTMLButtonElement {
  const item = [...container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
    (candidate) => candidate.textContent === label,
  );
  if (!item) throw new Error(`missing menu item: ${label}`);
  return item;
}

function confirmDialogButton(label: string): HTMLButtonElement {
  const dialog = document.querySelector('[role="alertdialog"]');
  if (!dialog) throw new Error("no confirm dialog is open");
  const button = [...dialog.querySelectorAll("button")].find((candidate) => candidate.textContent === label);
  if (!button) throw new Error(`missing confirm dialog button: ${label}`);
  return button;
}

async function pickCapacity(container: HTMLElement, email: string): Promise<void> {
  const input = container.querySelector<HTMLInputElement>(
    'input[placeholder="Search name, email, organization, or category…"]',
  )!;
  input.value = email;
  void act(() => {
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const search = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent === "Search",
  )!;
  await act(async () => search.click());
  await settle();
  const select = container.querySelector<HTMLSelectElement>('select[aria-label="Participation capacity"]')!;
  select.value = MEMBER_ID;
  void act(() => {
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function membershipsPage(userId: string, email: string) {
  return {
    memberships: [
      {
        id: MEMBER_ID,
        groupId: GROUP_ID,
        userId,
        memberId: MEMBER_ID,
        memberType: "organization",
        userName: "Selected Person",
        email,
        organizationName: "Example Member",
        membershipCategory: "A",
        source: "staff",
        createdByUserId: null,
        joinedAt: "2026-08-01T00:00:00.000Z",
        leftAt: null,
      },
    ],
    page: { limit: 8, offset: 0, total: 1, hasMore: false },
  };
}

beforeEach(() => {
  navigate.mockReset();
});

afterEach(() => {
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
  vi.unstubAllGlobals();
});

describe("portal group leadership management", () => {
  it("distinguishes inherited leadership and removes only local assignments", async () => {
    const requests: Array<{ url: URL; method: string }> = [];
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
          memberId: MEMBER_ID,
          memberType: "organization",
          organizationName: "Local Member Organization",
          jobTitle: "Standards lead",
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
          memberId: "20000000-0000-4000-8000-000000000002",
          memberType: "organization",
          organizationName: "Parent Member Organization",
          jobTitle: "Policy lead",
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
    const container = mount(
      <>
        <ConfirmDialogHost />
        <GroupLeadership groupId={GROUP_ID} />
      </>,
    );
    await settle();

    expect(container.textContent).toContain("inherited from Parent Group");
    const rowMenus = container.querySelectorAll('[aria-haspopup="menu"]');
    expect(rowMenus).toHaveLength(1);
    await openRowMenu(container, "Actions for Local Leader");
    await act(async () => menuItem(container, "Remove").click());
    await act(async () => confirmDialogButton("Remove from role").click());
    await settle();
    expect(
      requests.some(
        ({ url, method }) =>
          method === "DELETE" && url.pathname === `/api/v1/groups/${GROUP_ID}/leadership/${USER_ROLE_ID}`,
      ),
    ).toBe(true);
  });

  it("assigns local leadership with an optional expiry through the canonical group route", async () => {
    const userId = "40000000-0000-4000-8000-000000000009";
    const requests: Array<{ url: URL; method: string; body?: unknown }> = [];
    const leadership = {
      group: {
        id: GROUP_ID,
        slug: "architecture",
        name: "Architecture Committee",
        type: { key: "committee", singularLabel: "Committee", pluralLabel: "Committees" },
      },
      governanceInheritanceMode: "inherited",
      assignments: [],
    } as const;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        const method = init.method ?? "GET";
        const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
        requests.push({ url, method, body });
        if (url.pathname === `/api/v1/groups/${GROUP_ID}/memberships`)
          return json(membershipsPage(userId, "leader@example.test"));
        return json(leadership);
      }),
    );
    const container = mount(<GroupLeadership groupId={GROUP_ID} />);
    await settle();

    expect(container.querySelector('input[placeholder="Search name, email, organization, or category…"]')).toBeNull();
    const addLeadership = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "Add leadership",
    )!;
    await act(async () => addLeadership.click());
    await pickCapacity(container, "leader@example.test");

    const role = container.querySelector<HTMLSelectElement>("#managed-group-leadership-role")!;
    role.value = "role-group_deputy_lead";
    void act(() => {
      role.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const expiry = container.querySelector<HTMLInputElement>("#managed-group-leadership-expiry")!;
    expiry.value = "2026-10-01T12:30";
    void act(() => {
      expiry.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const add = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "Add",
    )!;
    await act(async () => add.click());
    await settle();

    const request = requests.find(
      ({ url, method }) => method === "POST" && url.pathname === `/api/v1/groups/${GROUP_ID}/leadership`,
    );
    expect(request?.body).toMatchObject({
      userId,
      memberId: MEMBER_ID,
      roleId: "role-group_deputy_lead",
    });
    expect((request?.body as { expiresAt: string }).expiresAt).toBe(new Date("2026-10-01T12:30").toISOString());
    expect(container.querySelector('input[placeholder="Search name, email, organization, or category…"]')).toBeNull();
  });

  it("keeps a rejected leadership assignment visible and does not report success", async () => {
    const userId = "40000000-0000-4000-8000-000000000009";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        if (url.pathname === `/api/v1/groups/${GROUP_ID}/memberships`)
          return json(membershipsPage(userId, "leader@example.test"));
        if ((init.method ?? "GET") === "POST") {
          return new Response(
            JSON.stringify({ error: { code: "GROUP_AUTHORIZATION_CHANGED", message: "Management access changed." } }),
            { status: 409, headers: { "content-type": "application/json" } },
          );
        }
        throw new Error(`Unexpected request: ${url.pathname}`);
      }),
    );
    const onAssigned = vi.fn(async () => {});
    const container = mount(<GroupLeadershipAssignmentForm groupId={GROUP_ID} onAssigned={onAssigned} />);
    await pickCapacity(container, "leader@example.test");

    const add = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "Add",
    )!;
    await act(async () => add.click());
    await settle();

    expect(container.textContent).toContain("Management access changed.");
    expect(container.textContent).not.toContain("Leadership assignment added.");
    expect(onAssigned).not.toHaveBeenCalled();
    expect(
      container.querySelector<HTMLInputElement>('input[placeholder="Search name, email, organization, or category…"]')
        ?.value,
    ).toBe("leader@example.test");
  });
});
