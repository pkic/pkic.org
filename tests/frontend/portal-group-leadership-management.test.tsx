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
const TITLES = { lead: "Chair", deputyLead: "Vice Chair" };
// The vocabulary the server answers with, not one the bundle knows: the
// options the title control offers come from this response (issue #29).
const TITLE_OPTIONS = {
  lead: ["Chair", "Co-Chair", "Lead", "Co-Lead", "President"],
  deputyLead: ["Vice Chair", "Deputy Lead", "Deputy Chair", "Vice President", "Secretary"],
};
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

/** Picks a candidate the way a reader does: type, then choose. */
async function pickCapacity(container: HTMLElement, email: string): Promise<void> {
  const input = controlFor(container, "Participant");
  setValue(input, email, "input");
  await settle();
  await chooseComboboxOption(container, "Participant", IDENTITY_ID);
}

/**
 * The candidates the group would admit. Not its membership roster: a group
 * whose participation follows from affiliation has an empty roster and every
 * eligible member as a candidate, which is why the picker asks this endpoint.
 */
function candidatesPage(userId: string, email: string, participating = true) {
  return {
    candidates: [
      {
        userId,
        identityId: IDENTITY_ID,
        memberId: MEMBER_ID,
        memberType: "organization",
        userName: "Selected Person",
        email,
        organizationName: "Example Member",
        membershipCategory: "A",
        participating,
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
  page: { limit: 50, offset: 0, total: 2, hasMore: false },
  pastPage: { limit: 50, offset: 0, total: 1, hasMore: false },
  group: sourceGroup,
  governanceInheritanceMode: "inherited",
  titles: TITLES,
  titleOptions: TITLE_OPTIONS,
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
    await settle();

    expect(container.textContent).toContain("Current leadership");
    expect(container.textContent).toContain("Inherited from Parent Group");
    expect(container.textContent).toContain("Vice Chair");
    expect(container.textContent).toContain("Since Jan 1, 2021");
    expect(container.textContent).toContain("Past leadership");
    expect(container.textContent).not.toContain("Former Chair");
    await act(async () => container.querySelector<HTMLButtonElement>("#leadership-view-past")!.click());
    await settle();
    expect(container.textContent).toContain("Former Chair");
    expect(container.textContent).toContain("Feb 14, 2013 – Jan 1, 2021");
    expect(container.querySelectorAll("table")).toHaveLength(1);
    await act(async () => container.querySelector<HTMLButtonElement>("#leadership-view-current")!.click());
    await settle();
    // The inherited deputy has no row menu; the local chair and the closed term do.
    expect(container.querySelectorAll('[aria-label^="Actions for"]')).toHaveLength(1);
    expect(container.querySelector('button[aria-label="Actions for Parent Deputy"]')).toBeNull();

    await openRowMenu(container, "Actions for Local Leader");
    await act(async () => menuItem(container, "End term now").click());
    expect(document.body.textContent).toContain("End Local Leader's term as Chair?");
    await act(async () => confirmDialogButton("End term").click());
    await settle();
    await settle();
    expect(
      requests.some(
        ({ url, method }) =>
          method === "DELETE" && url.pathname === `/api/v1/groups/${GROUP_ID}/leadership/${USER_ROLE_ID}`,
      ),
    ).toBe(true);
  });

  /*
   * Adding and editing are places, not modes. Both forms used to unfold above
   * the table, which made the table the page and the form a state of it:
   * nothing addressed the form, a reload lost it, and the list the reader was
   * leaving stayed underneath the thing they had moved on to.
   */
  describe("the add and edit pages", () => {
    it("sends a reader to the term's own address instead of opening a form over the list", async () => {
      stubFetch(() => json(leadership));
      const container = mount(<GroupLeadership groupId={GROUP_ID} />);
      await settle();
      await settle();

      await openRowMenu(container, "Actions for Local Leader");
      await act(async () => menuItem(container, "Edit term").click());
      expect(navigate).toHaveBeenCalledWith(`/groups/${GROUP_ID}/leadership/${USER_ROLE_ID}`);
      // Nothing unfolded: the list is still the whole page.
      expect(container.querySelector("form")).toBeNull();
      expect(container.textContent).toContain("Local Leader");

      await act(async () => button(container, "Add leadership").click());
      expect(navigate).toHaveBeenCalledWith(`/groups/${GROUP_ID}/leadership/add`);
    });

    it("shows one term's editor without the list it came from underneath it", async () => {
      stubFetch(() => json(leadership));
      const container = mount(<GroupLeadership groupId={GROUP_ID} assignmentSegment={USER_ROLE_ID} />);
      await settle();
      await settle();

      expect(container.textContent).toContain("Edit term for Local Leader");
      expect(container.textContent).not.toContain("Past leadership");
      expect(container.querySelector("table")).toBeNull();
    });

    it("returns to the list from an address that names no local term of this group", async () => {
      stubFetch(() => json(leadership));
      const stale = "30000000-0000-4000-8000-00000000ffff";
      const container = mount(<GroupLeadership groupId={GROUP_ID} assignmentSegment={stale} />);
      await settle();
      await settle();

      expect(navigate).toHaveBeenCalledWith(`/groups/${GROUP_ID}/leadership`);
      expect(container.querySelector("form")).toBeNull();
    });

    it("refuses to edit an inherited term here, because it is not this group's to change", async () => {
      stubFetch(() => json(leadership));
      // The parent's deputy appears on this group's list but is governed at
      // its source, so its address must not open an editor that would PATCH
      // another group's assignment.
      const inherited = "30000000-0000-4000-8000-000000000002";
      const container = mount(<GroupLeadership groupId={GROUP_ID} assignmentSegment={inherited} />);
      await settle();
      await settle();

      expect(navigate).toHaveBeenCalledWith(`/groups/${GROUP_ID}/leadership`);
      expect(container.textContent).not.toContain("Edit term for Parent Deputy");
    });
  });

  /*
   * Issue #26: appointing a chair had become "type a name, press Search, then
   * choose", where every other picker in the portal asks only for typing. The
   * matches must arrive from the keystrokes alone, and the form must offer
   * nothing to press in between.
   */
  it("offers matching people from the typing alone, with no Search button between the two", async () => {
    const userId = "40000000-0000-4000-8000-000000000009";
    stubFetch((url) => {
      if (url.pathname === `/api/v1/groups/${GROUP_ID}/leadership/candidates`)
        return json(candidatesPage(userId, "leader@example.test"));
      return json({ ...leadership, assignments: [], past: [] });
    });
    const container = mount(<GroupLeadership groupId={GROUP_ID} assignmentSegment="add" />);
    await settle();
    await settle();

    const participant = controlFor(container, "Participant");
    expect(participant.getAttribute("role")).toBe("combobox");
    expect(participant.getAttribute("aria-autocomplete")).toBe("list");
    // Nothing labelled Search exists to be pressed, before or after typing.
    const searchButtons = () =>
      [...container.querySelectorAll("button")].filter((candidate) => /search/i.test(candidate.textContent ?? ""));
    expect(searchButtons()).toEqual([]);

    setValue(participant, "leader", "input");
    await settle();
    await settle();
    expect(searchButtons()).toEqual([]);
    // The matches are there for the choosing without anything else happening.
    const options = [...container.querySelectorAll('[role="option"]')];
    expect(options.some((option) => option.getAttribute("data-key") === IDENTITY_ID)).toBe(true);
  });

  it("assigns leadership with the type's default title, a backdated start, and an optional end through the group route", async () => {
    const userId = "40000000-0000-4000-8000-000000000009";
    const requests = stubFetch((url) => {
      if (url.pathname === `/api/v1/groups/${GROUP_ID}/leadership/candidates`)
        return json(candidatesPage(userId, "leader@example.test", false));
      return json({ ...leadership, assignments: [], past: [] });
    });
    const container = mount(<GroupLeadership groupId={GROUP_ID} assignmentSegment="add" />);
    await settle();
    await settle();
    await pickCapacity(container, "leader@example.test");

    // The candidate is not seated in this group, so the form says the
    // appointment will seat them rather than leaving it to be discovered on
    // the Members tab afterwards.
    expect(container.textContent).toContain("does not participate in this group yet");

    const title = controlFor(container, "Title");
    expect(title.value).toBe("Chair");
    setValue(controlFor<HTMLSelectElement>(container, "Role"), "role-group_deputy_lead", "change");
    expect(controlFor(container, "Title").value).toBe("Vice Chair");
    setValue(controlFor(container, "Term starts"), "2024-07-01", "input");
    setValue(controlFor(container, "Term ends"), "2026-10-01", "input");
    await act(async () => button(container, "Assign leadership").click());
    await settle();
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
    // Assigning returns to the list, and returns before waiting on the reload,
    // so the reader is never left in front of a finished form.
    expect(navigate).toHaveBeenCalledWith(`/groups/${GROUP_ID}/leadership`);
  });

  it("edits a term's title and dates through the canonical update route", async () => {
    const requests = stubFetch(() => json(leadership));
    const container = mount(<GroupLeadership groupId={GROUP_ID} assignmentSegment={PAST_USER_ROLE_ID} />);
    await settle();
    await settle();

    // The title is a select of the role's own titles, not free text: a chair
    // should be offered rather than something you have to know to type.
    const title = controlFor<HTMLSelectElement>(container, "Title");
    expect(title.tagName).toBe("SELECT");
    expect([...title.options].map((option) => option.value)).toEqual(
      expect.arrayContaining(["Chair", "Co-Chair", "Lead"]),
    );
    expect(title.value).toBe("Chair");
    setValue(title, "Co-Chair", "change");
    setValue(controlFor(container, "Term ends"), "2021-06-30", "input");
    await act(async () => button(container, "Save term").click());
    await settle();
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

  /*
   * Issue #29's sweep: the options are the server's, so a vocabulary the
   * consortium changes must reach the control without a deploy, and a title
   * the server no longer offers must not be rewritten out from under a term
   * already served under it.
   */
  it("offers exactly the titles the server sent for the role, in the server's order", async () => {
    stubFetch(() =>
      json({
        ...leadership,
        titleOptions: { lead: ["Convenor", "Chair"], deputyLead: ["Deputy Convenor", "Vice Chair"] },
      }),
    );
    const container = mount(<GroupLeadership groupId={GROUP_ID} assignmentSegment={USER_ROLE_ID} />);
    await settle();
    await settle();

    const title = controlFor<HTMLSelectElement>(container, "Title");
    // "Co-Chair" and "Lead" are in no response here, so a control still
    // reading a bundled list would show them.
    expect([...title.options].map((option) => option.value)).toEqual(["Convenor", "Chair"]);
  });

  it("keeps a saved title the vocabulary no longer offers, rather than silently changing it", async () => {
    const requests = stubFetch(() =>
      json({
        ...leadership,
        titleOptions: { lead: ["Chair"], deputyLead: ["Vice Chair"] },
        past: [{ ...leadership.past[0], title: "Board Chair" }],
      }),
    );
    const container = mount(<GroupLeadership groupId={GROUP_ID} assignmentSegment={PAST_USER_ROLE_ID} />);
    await settle();
    await settle();

    const title = controlFor<HTMLSelectElement>(container, "Title");
    expect([...title.options].map((option) => option.value)).toEqual(["Board Chair", "Chair"]);
    expect(title.value).toBe("Board Chair");

    await act(async () => button(container, "Save term").click());
    await settle();
    await settle();
    const request = requests.find(({ method }) => method === "PATCH");
    expect(groupLeadershipUpdateSchema.parse(request?.body).title).toBe("Board Chair");
  });

  it("keeps a rejected leadership assignment visible and does not report success", async () => {
    const userId = "40000000-0000-4000-8000-000000000009";
    stubFetch((url, method) => {
      if (url.pathname === `/api/v1/groups/${GROUP_ID}/leadership/candidates`)
        return json(candidatesPage(userId, "leader@example.test"));
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
      <GroupLeadershipAssignmentForm
        groupId={GROUP_ID}
        titles={TITLES}
        titleOptions={TITLE_OPTIONS}
        onAssigned={onAssigned}
        onCancel={() => {}}
      />,
    );
    await pickCapacity(container, "leader@example.test");

    await act(async () => button(container, "Assign leadership").click());
    await settle();
    await settle();

    expect(container.textContent).toContain("Management access changed.");
    expect(onAssigned).not.toHaveBeenCalled();
    // The rejected assignment keeps its picked capacity: the combobox still
    // reads the chosen label rather than being wiped by the failure.
    expect(controlFor(container, "Participant").value).toBe("Selected Person — Example Member");
  });
});
