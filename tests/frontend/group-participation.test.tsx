// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SelfGroup } from "../../assets/shared/schemas/group-participation";
import { groupJoinSchema, groupLeaveSchema } from "../../assets/shared/schemas/groups";
import { ConfirmDialogHost } from "../../assets/ts/components/ConfirmDialog";
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
    representedMemberCount: 0,
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
  void act(() =>
    render(
      <>
        <ConfirmDialogHost />
        <GroupParticipationCard group={value} onChanged={onChanged} />
      </>,
      container,
    ),
  );
  return container;
}

/**
 * Controls are found by the name a reader hears, not by a styling class. The
 * previous selector named a framework utility class, which coupled every
 * assertion to the framework the surface has now dropped.
 */
function buttonNamed(container: HTMLElement, name: string): HTMLButtonElement {
  const button = [...container.querySelectorAll("button")].find((candidate) => candidate.textContent?.trim() === name);
  if (!button) throw new Error(`missing button: ${name}`);
  return button;
}

function dialogButton(container: HTMLElement, label: string): HTMLButtonElement {
  const dialog = container.querySelector('[role="alertdialog"]');
  if (!dialog) throw new Error("no confirm dialog is open");
  const button = [...dialog.querySelectorAll("button")].find((candidate) => candidate.textContent === label);
  if (!button) throw new Error(`missing dialog button: ${label}`);
  return button;
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

    void act(() => buttonNamed(container, "Join selected").click());
    await settle();
    expect(requests[0]?.url).toBe("/api/v1/groups/10000000-0000-4000-8000-000000000001/join");
    // Parsed through the shared request contract, so the assertion fails if
    // the surface ever sends a body the endpoint would reject.
    expect(groupJoinSchema.parse(JSON.parse(String(requests[0]?.init.body)))).toEqual({
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
    void act(() => buttonNamed(container, "Join selected").click());
    await settle();
    expect(groupJoinSchema.parse(body)).toEqual({
      capacitySelection: {
        mode: "selected",
        memberIds: ["20000000-0000-4000-8000-000000000001"],
      },
    });
  });

  it("adds and removes individual organization capacities without leaving the group", async () => {
    const requests: Array<{ url: string; body: unknown }> = [];
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

    void act(() => buttonNamed(container, "Add selected").click());
    await settle();
    expect(requests[0]?.url).toBe("/api/v1/groups/10000000-0000-4000-8000-000000000001/join");
    expect(groupJoinSchema.parse(requests[0]?.body)).toEqual({
      capacitySelection: {
        mode: "selected",
        memberIds: ["20000000-0000-4000-8000-000000000002"],
      },
    });

    const rowActionsTrigger = container.querySelector<HTMLButtonElement>('[aria-label="Actions for Organization A"]');
    if (!rowActionsTrigger) throw new Error("missing row actions trigger");
    void act(() => rowActionsTrigger.click());
    const removeItem = [...container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
      (candidate) => candidate.textContent === "Remove",
    );
    if (!removeItem) throw new Error("missing Remove menu item");
    void act(() => removeItem.click());

    const dialog = container.querySelector('[role="alertdialog"]');
    expect(dialog?.textContent).toContain("Stop participating in Architecture Group on behalf of Organization A?");

    void act(() => dialogButton(container, "Stop participating").click());
    await settle();
    expect(requests[1]?.url).toBe("/api/v1/groups/10000000-0000-4000-8000-000000000001/leave");
    expect(groupLeaveSchema.parse(requests[1]?.body)).toEqual({
      mode: "selected",
      memberIds: ["20000000-0000-4000-8000-000000000001"],
    });
  });

  it("keeps the affiliation when the removal confirmation is cancelled", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
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

    const rowActionsTrigger = container.querySelector<HTMLButtonElement>('[aria-label="Actions for Organization A"]');
    if (!rowActionsTrigger) throw new Error("missing row actions trigger");
    void act(() => rowActionsTrigger.click());
    const removeItem = [...container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
      (candidate) => candidate.textContent === "Remove",
    );
    if (!removeItem) throw new Error("missing Remove menu item");
    void act(() => removeItem.click());

    void act(() => dialogButton(container, "Cancel").click());
    await settle();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alertdialog"]')).toBeNull();
  });

  it("gives every capacity checkbox a label bound to it by id, drawn as a real control", () => {
    vi.stubGlobal("fetch", vi.fn());
    const container = mountCard(group());

    const checkboxes = [...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
    expect(checkboxes).toHaveLength(2);

    for (const checkbox of checkboxes) {
      const label = container.querySelector<HTMLLabelElement>(`label[for="${checkbox.id}"]`);
      expect(checkbox.id).not.toBe("");
      expect(label).not.toBeNull();
      expect(label?.textContent?.trim()).not.toBe("");
      // All three parts of the block, or the browser draws its own control:
      // the label alone passes every gate and renders an OS default checkbox.
      expect(label?.classList.contains("pk-check")).toBe(true);
      expect(checkbox.classList.contains("pk-check__input")).toBe(true);
      expect(label?.querySelector(".pk-check__label")).not.toBeNull();
    }

    // The set of affiliations is named, so it is not announced as a bare list.
    const affiliations = container.querySelector('ul[aria-label="Affiliations participating in Architecture Group"]');
    expect(affiliations).toBeNull();
    expect(container.querySelector("legend")?.textContent).toBe("Join on behalf of");
  });

  it("names the joined affiliations list and leaves the group card usable", () => {
    vi.stubGlobal("fetch", vi.fn());
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

    const affiliations = container.querySelector('ul[aria-label="Affiliations participating in Architecture Group"]');
    expect(affiliations?.textContent).toContain("Organization A");
    // "Joined" is a word, not only a colour.
    expect([...container.querySelectorAll(".pk-badge")].map((badge) => badge.textContent)).toEqual([
      "Working group",
      "Joined",
    ]);
  });

  it("reports a rejected join as a toast and leaves the selection intact", async () => {
    const toastArea = document.createElement("div");
    toastArea.id = "portal-toast-area";
    document.body.append(toastArea);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ error: { code: "FORBIDDEN", message: "You are not eligible for this group." } }),
            { status: 403, headers: { "content-type": "application/json" } },
          ),
      ),
    );

    const onChanged = vi.fn(async () => {});
    const container = mountCard(group(), onChanged);
    void act(() => buttonNamed(container, "Join selected").click());
    await settle();

    expect(onChanged).not.toHaveBeenCalled();
    expect(toastArea.textContent).toContain("You are not eligible for this group.");
    // The card recovers: the control is live again rather than stuck busy.
    const join = buttonNamed(container, "Join selected");
    expect(join.disabled).toBe(false);
    expect(join.getAttribute("aria-busy")).toBeNull();
    expect(
      [...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].every((box) => box.checked),
    ).toBe(true);

    toastArea.remove();
  });

  it("blocks the join control when nothing is selected", () => {
    vi.stubGlobal("fetch", vi.fn());
    const container = mountCard(group());
    const checkboxes = [...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
    void act(() => checkboxes[0]!.click());
    void act(() => checkboxes[1]!.click());

    const join = buttonNamed(container, "Join selected");
    expect(join.disabled).toBe(true);
    expect(join.getAttribute("aria-disabled")).toBe("true");
  });
});

describe("staff groups collection", () => {
  it("stays quiet for an active group and only badges the inactive one", async () => {
    portalSession.value = portalSessionFixture({ staff: true });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              groups: [
                group({
                  id: "10000000-0000-4000-8000-000000000010",
                  name: "Architecture Group",
                  active: true,
                }),
                group({
                  id: "10000000-0000-4000-8000-000000000011",
                  name: "Retired Group",
                  active: false,
                }),
              ],
              page: { limit: 25, offset: 0, total: 2, hasMore: false },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
      ),
    );

    const container = document.createElement("div");
    document.body.append(container);
    mounted.push(container);
    void act(() => render(<Groups />, container));
    await settle();

    const rows = [...container.querySelectorAll("tbody tr")];
    const activeRow = rows.find((row) => row.textContent?.includes("Architecture Group"));
    const inactiveRow = rows.find((row) => row.textContent?.includes("Retired Group"));
    if (!activeRow || !inactiveRow) throw new Error("missing expected group rows");

    // An active group is quiet on the page — no pill — but not silent to a
    // screen reader: the dash that stands in for the badge is decoration, and
    // the word beside it is what carries the state.
    expect(activeRow.querySelector(".pk-badge")).toBeNull();
    expect(activeRow.querySelector("[aria-hidden='true']")?.textContent).toBe("—");
    expect(activeRow.querySelector(".pk-sr-only")?.textContent).toBe("Active");
    expect(inactiveRow.querySelector(".pk-badge")?.textContent).toBe("Inactive");
  });

  it("names the staff table and its region, so it is not one card among several unnamed ones", async () => {
    portalSession.value = portalSessionFixture({ staff: true });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              groups: [group({ id: "10000000-0000-4000-8000-000000000012", name: "Architecture Group" })],
              page: { limit: 25, offset: 0, total: 1, hasMore: false },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
      ),
    );

    const container = document.createElement("div");
    document.body.append(container);
    mounted.push(container);
    void act(() => render(<Groups />, container));
    await settle();

    expect(container.querySelector("section.pk-panel")?.getAttribute("aria-label")).toBe("All groups");
    expect(container.querySelector("caption")?.textContent).toBe("All groups");
    // The row is activated by a real link, not a handler on the `<tr>`.
    const rowLink = container.querySelector<HTMLAnchorElement>("tbody a.pk-table__row-link");
    expect(rowLink?.textContent).toBe("Open Architecture Group");
    expect(rowLink?.getAttribute("href")).toContain("/groups/10000000-0000-4000-8000-000000000012/overview");
  });

  it("announces a failed member catalog as a sentence rather than an empty column", async () => {
    portalSession.value = portalSessionFixture({ member: true });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: "unavailable" }), {
            status: 503,
            headers: { "content-type": "application/json" },
          }),
      ),
    );

    const container = document.createElement("div");
    document.body.append(container);
    mounted.push(container);
    void act(() => render(<Groups />, container));
    await settle();

    const alert = container.querySelector("[role='alert']");
    expect(alert).not.toBeNull();
    expect(alert?.textContent).toContain("The service is temporarily unavailable.");
  });

  it("says the catalog is empty in an announced region rather than a muted line", async () => {
    portalSession.value = portalSessionFixture({ member: true });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ groups: [], page: { limit: 25, offset: 0, total: 0, hasMore: false } }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      ),
    );

    const container = document.createElement("div");
    document.body.append(container);
    mounted.push(container);
    void act(() => render(<Groups />, container));
    await settle();

    const empty = container.querySelector("[role='status']");
    expect(empty?.textContent).toContain("No groups are available right now.");
  });
});
