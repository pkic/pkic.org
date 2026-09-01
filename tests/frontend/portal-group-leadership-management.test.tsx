// @vitest-environment jsdom
import { render, type ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { groupLeadershipAssignSchema } from "../../assets/shared/schemas/groups";
import { ConfirmDialogHost } from "../../assets/ts/components/ConfirmDialog";
import { GroupLeadership } from "../../assets/ts/member-flows/portal/sections/management/GroupLeadership";
import { GroupLeadershipAssignmentForm } from "../../assets/ts/member-flows/portal/sections/management/GroupLeadershipAssignmentForm";
import { buttonNamed, chooseOption, controlFor, typeInto } from "./helpers/labelled-control";
import { rowActionControlNames, runRowAction } from "./helpers/row-actions";

const navigate = vi.fn();

vi.mock("wouter/use-hash-location", () => ({
  useHashLocation: () => ["", navigate],
}));

const GROUP_ID = "10000000-0000-4000-8000-000000000001";
const USER_ROLE_ID = "30000000-0000-4000-8000-000000000001";
const MEMBER_ID = "20000000-0000-4000-8000-000000000001";
const IDENTITY_ID = "20000000-0000-4000-8000-000000000011";
const SEARCH_PLACEHOLDER = "Search name, email, organization, or category…";
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

function confirmDialogButton(label: string): HTMLButtonElement {
  const dialog = document.querySelector('[role="alertdialog"]');
  if (!dialog) throw new Error("no confirm dialog is open");
  const button = [...dialog.querySelectorAll("button")].find((candidate) => candidate.textContent === label);
  if (!button) throw new Error(`missing confirm dialog button: ${label}`);
  return button;
}

/** Every announced alert in `root`, so an error path is checked as announced. */
function alertTexts(root: ParentNode): string[] {
  return [...root.querySelectorAll('[role="alert"]')].map((node) => node.textContent ?? "");
}

/** The roster's own table, located by the caption that names it. */
function tableNamed(root: ParentNode, caption: string): HTMLTableElement {
  const match = [...root.querySelectorAll("table")].find(
    (candidate) => candidate.querySelector("caption")?.textContent === caption,
  );
  if (!match) throw new Error(`no table is captioned "${caption}"`);
  return match;
}

async function pickCapacity(container: HTMLElement, email: string): Promise<void> {
  await typeInto(container.querySelector<HTMLInputElement>(`input[placeholder="${SEARCH_PLACEHOLDER}"]`)!, email);
  await act(async () => buttonNamed(container, "Search").click());
  await settle();
  await chooseOption(controlFor<HTMLSelectElement>(container, "Participation capacity"), MEMBER_ID);
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
        joinedAt: "2026-08-01T00:00:00.000Z",
        leftAt: null,
      },
    ],
    page: { limit: 8, offset: 0, total: 1, hasMore: false },
  };
}

const GROUP_LABEL = {
  id: GROUP_ID,
  slug: "architecture",
  name: "Architecture Committee",
  type: { key: "committee", singularLabel: "Committee", pluralLabel: "Committees" },
} as const;

const LOCAL_ASSIGNMENT = {
  userRoleId: USER_ROLE_ID,
  userId: "40000000-0000-4000-8000-000000000001",
  identityId: IDENTITY_ID,
  memberId: MEMBER_ID,
  memberType: "organization",
  organizationName: "Local Member Organization",
  jobTitle: "Standards lead",
  userName: "Local Leader",
  email: "local@example.test",
  roleId: "role-group_lead",
  sourceGroup: GROUP_LABEL,
  inherited: false,
  expiresAt: null,
  createdAt: "2026-08-01T00:00:00.000Z",
} as const;

const INHERITED_ASSIGNMENT = {
  userRoleId: "30000000-0000-4000-8000-000000000002",
  userId: "40000000-0000-4000-8000-000000000002",
  identityId: "20000000-0000-4000-8000-000000000012",
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
} as const;

function leadershipList(assignments: readonly unknown[]) {
  return { group: GROUP_LABEL, governanceInheritanceMode: "inherited", assignments };
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
    const leadership = leadershipList([LOCAL_ASSIGNMENT, INHERITED_ASSIGNMENT]);
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

    // The source of an assignment is a column of its own, so the fact that
    // decides whether a row can be removed is stated rather than implied by
    // the row's missing menu.
    expect(container.textContent).toContain("Inherited from Parent Group");
    expect(container.textContent).toContain("Local");
    // Only the local assignment can be removed, and the control that removes
    // it names the person rather than reading "Remove" like any other row's.
    expect(rowActionControlNames(container)).toEqual(["Remove, Local Leader"]);
    await runRowAction(container, "Local Leader", "Remove");
    await act(async () => confirmDialogButton("Remove from role").click());
    await settle();
    expect(
      requests.some(
        ({ url, method }) =>
          method === "DELETE" && url.pathname === `/api/v1/groups/${GROUP_ID}/leadership/${USER_ROLE_ID}`,
      ),
    ).toBe(true);
  });

  it("names the roster, its region, and its columns for assistive technology", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(leadershipList([LOCAL_ASSIGNMENT, INHERITED_ASSIGNMENT]))),
    );
    const container = mount(<GroupLeadership groupId={GROUP_ID} />);
    await settle();

    // A group workspace stacks several of these panels; an unnamed <section>
    // is announced as nothing at all.
    expect(container.querySelector('section[aria-label="Effective leadership"]')).not.toBeNull();

    const table = tableNamed(container, "Effective leadership of this group");
    expect([...table.querySelectorAll("thead th")].map((th) => th.textContent)).toEqual([
      "Person",
      "Role",
      "Source",
      "Expires",
      "Actions",
    ]);
    // The actions column is named for a screen reader and hidden for everyone
    // else, rather than being an unnamed header cell.
    expect(table.querySelector("thead th:last-child span")?.className).toContain("pk-table__sr");
    expect(table.querySelectorAll("tbody tr")).toHaveLength(2);
  });

  it("announces a failed removal and keeps the assignment in the roster", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        if ((init.method ?? "GET") === "DELETE") {
          return json({ error: { code: "GROUP_AUTHORIZATION_CHANGED", message: "Management access changed." } }, 409);
        }
        return json(leadershipList([LOCAL_ASSIGNMENT]));
      }),
    );
    const container = mount(
      <>
        <ConfirmDialogHost />
        <GroupLeadership groupId={GROUP_ID} />
      </>,
    );
    await settle();

    await runRowAction(container, "Local Leader", "Remove");
    await act(async () => confirmDialogButton("Remove from role").click());
    await settle();

    expect(alertTexts(container).join(" ")).toContain("Management access changed.");
    expect(tableNamed(container, "Effective leadership of this group").querySelectorAll("tbody tr")).toHaveLength(1);
  });

  it("states an empty roster rather than rendering a bare table", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(leadershipList([]))),
    );
    const container = mount(<GroupLeadership groupId={GROUP_ID} />);
    await settle();

    const empty = container.querySelector('[role="status"].pk-empty-state');
    expect(empty?.textContent).toContain("No effective leadership.");
  });

  it("replaces the roster with the error when leadership cannot be loaded", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ error: { code: "FORBIDDEN", message: "Group leadership is not visible." } }, 403)),
    );
    const container = mount(<GroupLeadership groupId={GROUP_ID} />);
    await settle();

    expect(alertTexts(container).join(" ")).toContain("Group leadership is not visible.");
    // "No effective leadership" is a claim about the group, and the surface
    // does not know that when the request never arrived.
    expect(container.querySelector("table")).toBeNull();
    expect(container.textContent).not.toContain("No effective leadership.");
  });

  it("assigns local leadership with an optional expiry through the canonical group route", async () => {
    const userId = "40000000-0000-4000-8000-000000000009";
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
        if (url.pathname === `/api/v1/groups/${GROUP_ID}/memberships`)
          return json(membershipsPage(userId, "leader@example.test"));
        return json(leadershipList([]));
      }),
    );
    const container = mount(<GroupLeadership groupId={GROUP_ID} />);
    await settle();

    expect(container.querySelector(`input[placeholder="${SEARCH_PLACEHOLDER}"]`)).toBeNull();
    await act(async () => buttonNamed(container, "Add leadership").click());
    await pickCapacity(container, "leader@example.test");

    await chooseOption(controlFor<HTMLSelectElement>(container, "Role"), "role-group_deputy_lead");
    await typeInto(controlFor(container, "Expires"), "2026-10-01T12:30");
    await act(async () => buttonNamed(container, "Add").click());
    await settle();

    const request = requests.find(
      ({ url, method }) => method === "POST" && url.pathname === `/api/v1/groups/${GROUP_ID}/leadership`,
    );
    // Parsed through the shared request contract, so the wire body is checked
    // against the schema the route validates rather than against a literal.
    const sent = groupLeadershipAssignSchema.parse(request?.body);
    expect(sent).toMatchObject({ userId, identityId: IDENTITY_ID, roleId: "role-group_deputy_lead" });
    expect(sent.expiresAt).toBe(new Date("2026-10-01T12:30").toISOString());
    expect(container.querySelector(`input[placeholder="${SEARCH_PLACEHOLDER}"]`)).toBeNull();
  });

  it("wires each control to the label and help text that name it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(membershipsPage("40000000-0000-4000-8000-000000000009", "leader@example.test"))),
    );
    const container = mount(
      <GroupLeadershipAssignmentForm groupId={GROUP_ID} onAssigned={async () => {}} onCancel={() => {}} />,
    );
    await settle();

    // `controlFor` resolves through the for/id pair itself, so it fails
    // exactly when the labelling contract is broken.
    expect(controlFor<HTMLSelectElement>(container, "Role").tagName).toBe("SELECT");
    const expiry = controlFor(container, "Expires");
    expect(expiry.getAttribute("type")).toBe("datetime-local");
    const describedBy = expiry.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(container.querySelector(`#${describedBy!}`)?.textContent).toContain("Leave blank");
    expect(buttonNamed(container, "Cancel")).toBeTruthy();
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
          return json({ error: { code: "GROUP_AUTHORIZATION_CHANGED", message: "Management access changed." } }, 409);
        }
        throw new Error(`Unexpected request: ${url.pathname}`);
      }),
    );
    const onAssigned = vi.fn(async () => {});
    const container = mount(<GroupLeadershipAssignmentForm groupId={GROUP_ID} onAssigned={onAssigned} />);
    await pickCapacity(container, "leader@example.test");

    await act(async () => buttonNamed(container, "Add").click());
    await settle();

    expect(alertTexts(container).join(" ")).toContain("Management access changed.");
    expect(container.textContent).not.toContain("Leadership assignment added.");
    expect(onAssigned).not.toHaveBeenCalled();
    expect(container.querySelector<HTMLInputElement>(`input[placeholder="${SEARCH_PLACEHOLDER}"]`)?.value).toBe(
      "leader@example.test",
    );
  });
});
