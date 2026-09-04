// @vitest-environment jsdom
import { render, type ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { groupLeadershipAssignSchema, groupLeadershipUpdateSchema } from "../../assets/shared/schemas/groups";
import { ConfirmDialogHost } from "../../assets/ts/components/ConfirmDialog";
import { GroupLeadership } from "../../assets/ts/member-flows/portal/sections/management/GroupLeadership";
import { GroupLeadershipAssignmentForm } from "../../assets/ts/member-flows/portal/sections/management/GroupLeadershipAssignmentForm";
import { chooseComboboxOption, controlFor } from "./helpers/labelled-control";

const navigate = vi.fn();

vi.mock("wouter/use-hash-location", () => ({
  useHashLocation: () => ["", navigate],
}));

const GROUP_ID = "10000000-0000-4000-8000-000000000001";
const USER_ROLE_ID = "30000000-0000-4000-8000-000000000001";
const PAST_USER_ROLE_ID = "30000000-0000-4000-8000-000000000003";
const MEMBER_ID = "20000000-0000-4000-8000-000000000001";
const IDENTITY_ID = "20000000-0000-4000-8000-000000000011";
const TITLES = { lead: "Chair", deputyLead: "Vice Chair" } as const;
const mounted: HTMLElement[] = [];

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
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

function button(container: HTMLElement, label: string): HTMLButtonElement {
  const found = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (candidate) => candidate.textContent === label,
  );
  if (!found) throw new Error(`missing button: ${label}`);
  return found;
}

function confirmDialogButton(label: string): HTMLButtonElement {
  const dialog = document.querySelector('[role="alertdialog"]');
  if (!dialog) throw new Error("no confirm dialog is open");
  const found = [...dialog.querySelectorAll("button")].find((candidate) => candidate.textContent === label);
  if (!found) throw new Error(`missing confirm dialog button: ${label}`);
  return found;
}

function setValue(element: HTMLInputElement | HTMLSelectElement, value: string, event: "input" | "change"): void {
  element.value = value;
  void act(() => {
    element.dispatchEvent(new Event(event, { bubbles: true }));
  });
}

/** Picks a participation capacity the way a reader does: type, then choose. */
async function pickCapacity(container: HTMLElement, email: string): Promise<void> {
  const input = controlFor(container, "Participant");
  setValue(input, email, "input");
  await settle();
  await chooseComboboxOption(container, "Participant", MEMBER_ID);
}

function membershipsPage(userId: string, email: string) {
  return {
    memberships: [
      {
        id: MEMBER_ID,
        groupId: GROUP_ID,
        userId,
        identityId: IDENTITY_ID,
        memberId: MEMBER_ID,
        memberType: "organization",
        userName: "Selected Person",
        email,
        organizationName: "Example Member",
        membershipCategory: "A",
        source: "staff",
        createdByUserId: null,
        title: null,
        joinedAt: "2026-08-01T00:00:00.000Z",
        leftAt: null,
      },
    ],
    page: { limit: 8, offset: 0, total: 1, hasMore: false },
  };
}

const sourceGroup = {
  id: GROUP_ID,
  slug: "architecture",
  name: "Architecture Committee",
  type: { key: "committee", singularLabel: "Committee", pluralLabel: "Committees" },
};

function assignment(overrides: Record<string, unknown>) {
  return {
    userRoleId: USER_ROLE_ID,
    userId: "40000000-0000-4000-8000-000000000001",
    identityId: IDENTITY_ID,
    memberId: MEMBER_ID,
    memberType: "organization",
    organizationName: "Local Member Organization",
    jobTitle: "Standards lead",
    headshotUrl: null,
    userName: "Local Leader",
    email: "local@example.test",
    roleId: "role-group_lead",
    title: "Chair",
    sourceGroup,
    inherited: false,
    active: true,
    startsAt: "2021-01-01T00:00:00.000Z",
    endsAt: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

const leadership = {
  group: sourceGroup,
  governanceInheritanceMode: "inherited",
  titles: TITLES,
  assignments: [
    assignment({}),
    assignment({
      userRoleId: "30000000-0000-4000-8000-000000000002",
      userId: "40000000-0000-4000-8000-000000000002",
      identityId: "20000000-0000-4000-8000-000000000012",
      memberId: "20000000-0000-4000-8000-000000000002",
      organizationName: "Parent Member Organization",
      jobTitle: "Policy lead",
      userName: "Parent Deputy",
      email: "parent@example.test",
      roleId: "role-group_deputy_lead",
      title: "Vice Chair",
      sourceGroup: {
        id: "10000000-0000-4000-8000-000000000002",
        slug: "parent",
        name: "Parent Group",
        type: { key: "working_group", singularLabel: "Working Group", pluralLabel: "Working Groups" },
      },
      inherited: true,
    }),
  ],
  past: [
    assignment({
      userRoleId: PAST_USER_ROLE_ID,
      userId: "40000000-0000-4000-8000-000000000003",
      userName: "Former Chair",
      email: "former@example.test",
      title: "Chair",
      active: false,
      startsAt: "2013-02-14T00:00:00.000Z",
      endsAt: "2021-01-01T00:00:00.000Z",
    }),
  ],
} as const;

function stubFetch(handle: (url: URL, method: string, body: unknown) => Response | Promise<Response>) {
  const requests: Array<{ url: URL; method: string; body?: unknown }> = [];
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
      return handle(url, method, body);
    }),
  );
  return requests;
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
  it("shows titled terms, separates past leadership, and ends only local terms through the confirm dialog", async () => {
    const requests = stubFetch(() => json(leadership));
    const container = mount(
      <>
        <ConfirmDialogHost />
        <GroupLeadership groupId={GROUP_ID} />
      </>,
    );
    await settle();

    expect(container.textContent).toContain("Current leadership");
    expect(container.textContent).toContain("Inherited from Parent Group");
    expect(container.textContent).toContain("Vice Chair");
    expect(container.textContent).toContain("Since Jan 1, 2021");
    expect(container.textContent).toContain("Past leadership");
    expect(container.textContent).toContain("Former Chair");
    expect(container.textContent).toContain("Feb 14, 2013 – Jan 1, 2021");
    // The inherited deputy has no row menu; the local chair and the closed term do.
    expect(container.querySelectorAll('[aria-haspopup="menu"]')).toHaveLength(2);
    expect(container.querySelector('button[aria-label="Actions for Parent Deputy"]')).toBeNull();

    await openRowMenu(container, "Actions for Local Leader");
    await act(async () => menuItem(container, "End term now").click());
    expect(document.body.textContent).toContain("End Local Leader's term as Chair?");
    await act(async () => confirmDialogButton("End term").click());
    await settle();
    expect(
      requests.some(
        ({ url, method }) =>
          method === "DELETE" && url.pathname === `/api/v1/groups/${GROUP_ID}/leadership/${USER_ROLE_ID}`,
      ),
    ).toBe(true);
  });

  it("assigns leadership with the type's default title, a backdated start, and an optional end through the group route", async () => {
    const userId = "40000000-0000-4000-8000-000000000009";
    const requests = stubFetch((url) => {
      if (url.pathname === `/api/v1/groups/${GROUP_ID}/memberships`)
        return json(membershipsPage(userId, "leader@example.test"));
      return json({ ...leadership, assignments: [], past: [] });
    });
    const container = mount(<GroupLeadership groupId={GROUP_ID} />);
    await settle();

    expect(container.textContent).toContain("No leadership yet");
    await act(async () => button(container, "Add leadership").click());
    await pickCapacity(container, "leader@example.test");

    const title = controlFor(container, "Title");
    expect(title.value).toBe("Chair");
    setValue(controlFor<HTMLSelectElement>(container, "Role"), "role-group_deputy_lead", "change");
    expect(controlFor(container, "Title").value).toBe("Vice Chair");
    setValue(controlFor(container, "Term starts"), "2024-07-01", "input");
    setValue(controlFor(container, "Term ends"), "2026-10-01", "input");
    await act(async () => button(container, "Assign leadership").click());
    await settle();

    const request = requests.find(
      ({ url, method }) => method === "POST" && url.pathname === `/api/v1/groups/${GROUP_ID}/leadership`,
    );
    expect(groupLeadershipAssignSchema.parse(request?.body)).toEqual({
      userId,
      identityId: IDENTITY_ID,
      roleId: "role-group_deputy_lead",
      title: "Vice Chair",
      startsAt: "2024-07-01T00:00:00.000Z",
      endsAt: "2026-10-01T00:00:00.000Z",
    });
    expect(container.querySelector('input[placeholder="Search name, email, organization, or category…"]')).toBeNull();
  });

  it("edits a term's title and dates through the canonical update route", async () => {
    const requests = stubFetch(() => json(leadership));
    const container = mount(<GroupLeadership groupId={GROUP_ID} />);
    await settle();

    await openRowMenu(container, "Actions for Former Chair");
    await act(async () => menuItem(container, "Edit term").click());
    const title = controlFor(container, "Title");
    expect(title.value).toBe("Chair");
    setValue(title, "Co-Chair", "input");
    setValue(controlFor(container, "Term ends"), "2021-06-30", "input");
    await act(async () => button(container, "Save term").click());
    await settle();

    const request = requests.find(
      ({ url, method }) =>
        method === "PATCH" && url.pathname === `/api/v1/groups/${GROUP_ID}/leadership/${PAST_USER_ROLE_ID}`,
    );
    expect(groupLeadershipUpdateSchema.parse(request?.body)).toEqual({
      title: "Co-Chair",
      startsAt: "2013-02-14T00:00:00.000Z",
      endsAt: "2021-06-30T00:00:00.000Z",
    });
  });

  it("keeps a rejected leadership assignment visible and does not report success", async () => {
    const userId = "40000000-0000-4000-8000-000000000009";
    stubFetch((url, method) => {
      if (url.pathname === `/api/v1/groups/${GROUP_ID}/memberships`)
        return json(membershipsPage(userId, "leader@example.test"));
      if (method === "POST") {
        return new Response(
          JSON.stringify({ error: { code: "GROUP_AUTHORIZATION_CHANGED", message: "Management access changed." } }),
          { status: 409, headers: { "content-type": "application/json" } },
        );
      }
      throw new Error(`Unexpected request: ${url.pathname}`);
    });
    const onAssigned = vi.fn(async () => {});
    const container = mount(
      <GroupLeadershipAssignmentForm groupId={GROUP_ID} titles={TITLES} onAssigned={onAssigned} onCancel={() => {}} />,
    );
    await pickCapacity(container, "leader@example.test");

    await act(async () => button(container, "Assign leadership").click());
    await settle();

    expect(container.textContent).toContain("Management access changed.");
    expect(onAssigned).not.toHaveBeenCalled();
    // The rejected assignment keeps its picked capacity: the combobox still
    // reads the chosen label rather than being wiped by the failure.
    expect(controlFor(container, "Participant").value).toBe("Selected Person — Example Member");
  });
});
