// @vitest-environment jsdom
import { render, type ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfirmDialogHost } from "../../assets/ts/components/ConfirmDialog";
import { GroupMembers } from "../../assets/ts/member-flows/portal/sections/management/GroupMembers";
import { GroupMeetings } from "../../assets/ts/member-flows/portal/sections/management/GroupMeetings";
import { groupMemberAddSchema } from "../../assets/shared/schemas/groups";
import {
  buttonNamed,
  buttonNames,
  controlFor,
  groupNames,
  labelNames,
  namedGroup,
  typeInto,
} from "./helpers/labelled-control";
import { rowActionControlNames, runRowAction } from "./helpers/row-actions";

const navigate = vi.fn();

vi.mock("wouter/use-hash-location", () => ({
  useHashLocation: () => ["", navigate],
}));

vi.mock("wouter", () => ({
  Link: ({ children, href, ...rest }: { children?: ComponentChildren; href: string } & Record<string, unknown>) => (
    <a href={`#${href}`} {...rest}>
      {children}
    </a>
  ),
}));

const GROUP_ID = "10000000-0000-4000-8000-000000000001";
const MEMBERSHIP_ID = "20000000-0000-4000-8000-000000000001";
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

function confirmDialogButton(label: string): HTMLButtonElement {
  const dialog = document.querySelector('[role="alertdialog"]');
  if (!dialog) throw new Error("no confirm dialog is open");
  const button = [...dialog.querySelectorAll("button")].find((candidate) => candidate.textContent === label);
  if (!button) throw new Error(`missing confirm dialog button: ${label}`);
  return button;
}

async function pickUser(container: HTMLElement, email: string): Promise<void> {
  const input = container.querySelector<HTMLInputElement>('input[placeholder="Search by email or name…"]')!;
  input.value = email;
  void act(() => {
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => new Promise((resolve) => setTimeout(resolve, 275)));
  const option = [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
    button.textContent?.includes(email),
  );
  expect(option).toBeDefined();
  void act(() => option!.click());
}

function usersPage(id: string, email: string) {
  return {
    users: [
      {
        id,
        email,
        first_name: "Selected",
        last_name: "Person",
        organization_name: "Example Member",
        role: "user",
        active: 1,
        created_at: "2026-08-01T00:00:00.000Z",
        member_id: null,
        member_category: null,
        member_status: null,
        member_organization_id: null,
        member_organization_name: null,
        links: [],
        membership: null,
        type: "contact_only",
        eventParticipationCount: 0,
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

describe("portal group management resources", () => {
  const SERIES_ID = "60000000-0000-4000-8000-000000000001";
  const MEETING_SERIES = {
    id: SERIES_ID,
    eventId: "70000000-0000-4000-8000-000000000001",
    ownerGroupId: GROUP_ID,
    eventName: "Architecture call",
    eventSlug: "architecture-call",
    profileKey: "meeting",
    registrationPolicy: "no_registration",
    visibility: "group_members",
    memberEligibility: "owner_group",
    guestPolicy: "occurrence_invitation",
    startsAt: "2026-09-01T15:00:00.000Z",
    recurrenceRule: "FREQ=WEEKLY;INTERVAL=1",
    timezone: "Europe/Amsterdam",
    durationMinutes: 60,
    location: "https://meet.example.test/architecture",
    providerType: null,
    providerConfigured: false,
    active: true,
    inviteWindow: { startsAt: null, endsAt: null, timezone: "Europe/Amsterdam" },
    nextOccurrenceAt: "2026-09-01T15:00:00.000Z",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    capabilities: ["view", "register", "attend", "manage_attendance", "manage"],
    occurrenceCount: 0,
  } as const;
  const SERIES_PAGE = { limit: 25, offset: 0, total: 1, hasMore: false };

  function requestUrl(input: RequestInfo | URL): URL {
    return new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.origin);
  }

  it("creates a recurring meeting series on its own page and opens the new record", async () => {
    const requests: Array<{ url: URL; method: string; body?: unknown }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const method = init.method ?? "GET";
        const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
        requests.push({ url: requestUrl(input), method, body });
        if (method === "POST") return json({ series: MEETING_SERIES });
        return json({ series: [], page: { ...SERIES_PAGE, total: 0 } });
      }),
    );
    const list = mount(<GroupMeetings groupId={GROUP_ID} canManage />);
    await settle();

    expect(list.textContent).toContain("No meeting series yet");
    // "New series" is a place: it navigates to the create page rather than
    // unfolding a form over the list.
    expect(labelNames(list)).not.toContain("Meeting name");
    await act(async () => buttonNamed(list, "New series").click());
    expect(navigate).toHaveBeenCalledWith(`/groups/${GROUP_ID}/meetings/new`);

    const createPage = mount(<GroupMeetings groupId={GROUP_ID} canManage seriesSegment="new" />);
    expect(labelNames(createPage)).toContain("Meeting name");
    await typeInto(controlFor(createPage, "Meeting name"), "Architecture call");
    await settle();
    await act(async () => buttonNamed(createPage, "Create meeting series").click());
    await settle();
    await settle();

    const request = requests.find(({ method }) => method === "POST");
    expect(request?.url.pathname).toBe(`/api/v1/groups/${GROUP_ID}/meetings/series`);
    expect(request?.body).toMatchObject({
      eventName: "Architecture call",
      eventSlug: "architecture-call",
      profileKey: "meeting",
      policy: {
        registrationPolicy: "no_registration",
        memberEligibility: "owner_group",
        guestPolicy: "occurrence_invitation",
      },
    });
    // The new series is the next thing to look at, so creation lands on it.
    expect(navigate).toHaveBeenCalledWith(`/groups/${GROUP_ID}/meetings/${SERIES_ID}`);
    expect(requests.some(({ url }) => url.pathname.includes("working-groups"))).toBe(false);
    expect(requests.some(({ url }) => url.pathname.includes("/admin/"))).toBe(false);
  });

  it("sends a reader without the manage capability from the create page back to the list", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ series: [], page: { ...SERIES_PAGE, total: 0 } })),
    );

    const container = mount(<GroupMeetings groupId={GROUP_ID} canManage={false} seriesSegment="new" />);
    await settle();

    expect(labelNames(container)).not.toContain("Meeting name");
    expect(navigate).toHaveBeenCalledWith(`/groups/${GROUP_ID}/meetings`);
  });

  it("links each meeting series row to its record and keeps the calendar download behind the row's menu", async () => {
    const requests: URL[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        requests.push(requestUrl(input));
        return json({ series: [MEETING_SERIES], page: SERIES_PAGE });
      }),
    );

    const container = mount(<GroupMeetings groupId={GROUP_ID} canManage />);
    await settle();

    // A series is a URL-addressed record, so the row is a link to it — it can
    // be opened in a new tab — and nothing unfolds between the rows.
    const rowLink = container.querySelector<HTMLAnchorElement>("tbody a.pk-table__row-link");
    expect(rowLink?.textContent).toBe("Open Architecture call");
    expect(rowLink?.getAttribute("href")).toBe(`#/groups/${GROUP_ID}/meetings/${SERIES_ID}`);
    expect(container.querySelector("button.pk-table__row-link")).toBeNull();

    // The calendar download is a command behind the row's menu, and it
    // navigates to the canonical group route.
    const openWindow = vi.spyOn(window, "open").mockReturnValue(null);
    await runRowAction(container, "Architecture call", "Download calendar");
    expect(openWindow).toHaveBeenCalledWith(
      `/api/v1/groups/${GROUP_ID}/meetings/series/${SERIES_ID}/calendar.ics`,
      "_self",
    );
    openWindow.mockRestore();
    expect(requests.some((url) => url.pathname.includes("working-groups"))).toBe(false);
    expect(requests.some((url) => url.pathname.includes("/admin/"))).toBe(false);
  });

  it("opens a meeting series record from its URL segment and reports a failed occurrences fetch", async () => {
    const requests: URL[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = requestUrl(input);
        requests.push(url);
        if (url.pathname.endsWith("/occurrences")) {
          return new Response(JSON.stringify({ message: "Server error" }), { status: 500 });
        }
        return json({ series: MEETING_SERIES });
      }),
    );

    const container = mount(<GroupMeetings groupId={GROUP_ID} canManage seriesSegment={SERIES_ID} />);
    await settle();
    await settle();

    // The record fetches its own series by id rather than borrowing a list
    // row, so a copied URL lands on the same page the row would have opened.
    expect(requests.map((url) => url.pathname)).toContain(`/api/v1/groups/${GROUP_ID}/meetings/series/${SERIES_ID}`);
    expect(container.querySelector("h3.pk-record-title")?.textContent).toBe("Architecture call");
    expect(container.textContent).toContain("on our side");
  });

  it("searches and removes exact membership capacities through canonical group routes", async () => {
    const requests: Array<{ url: URL; method: string }> = [];
    let removed = false;
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
                  identityId: "50000000-0000-4000-8000-000000000011",
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
    const container = mount(
      <>
        <ConfirmDialogHost />
        <GroupMembers groupId={GROUP_ID} canManage onChanged={onChanged} />
      </>,
    );
    await settle();

    expect(container.textContent).toContain("Member Person");
    expect(container.textContent).toContain("Member Organization");

    // What a visual review cannot see: the panel names itself among the
    // group workspace's stack of panels, and the table is identifiable in a
    // page that holds several of them rather than announced as "table".
    expect(container.querySelector("section")?.getAttribute("aria-label")).toBe("Members");
    expect(container.querySelector("caption")?.textContent).toBe("Members");
    // The actions column names each row's subject instead of the control, so
    // a roster of "Remove" buttons is still a roster of distinct controls.
    expect(rowActionControlNames(container)).toEqual(["Actions for Member Person"]);

    // The search box is reached through its own `for`/`id` pair, so this
    // lookup fails exactly when the labelling does.
    const search = controlFor(container, "Search members");
    await typeInto(search, "member@example.test");
    await settle();
    void act(() => {
      search.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    await settle();
    expect(requests.at(-1)?.url.searchParams.get("q")).toBe("member@example.test");

    await runRowAction(container, "Member Person", "Remove");
    await act(async () => confirmDialogButton("End participation").click());
    await settle();
    expect(
      requests.some(
        ({ url, method }) =>
          method === "DELETE" && url.pathname === `/api/v1/groups/${GROUP_ID}/memberships/${MEMBERSHIP_ID}`,
      ),
    ).toBe(true);
    expect(onChanged).toHaveBeenCalledOnce();
  });

  it("adds a person through every eligible Member capacity using the canonical group command", async () => {
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
        if (url.pathname === `/api/v1/groups/${GROUP_ID}/users`)
          return json(usersPage(userId, "selected@example.test"));
        if (method === "POST") {
          return json({
            group: {
              id: GROUP_ID,
              slug: "architecture",
              name: "Architecture Committee",
              type: { key: "committee", singularLabel: "Committee", pluralLabel: "Committees" },
            },
            memberships: [],
            endedMembershipIds: [],
          });
        }
        return json({ memberships: [], page: { limit: 25, offset: 0, total: 0, hasMore: false } });
      }),
    );
    const onChanged = vi.fn(async () => {});
    const container = mount(<GroupMembers groupId={GROUP_ID} canManage onChanged={onChanged} />);
    await settle();

    expect(container.querySelector('input[placeholder="Search by email or name…"]')).toBeNull();
    await act(async () => buttonNamed(container, "Add person").click());

    // The picker names its own search box, so the heading beside it is the
    // `<legend>` of the group it belongs to rather than a `<label>` pointing
    // at nothing — and that group is what goes inert while the add is running.
    expect(groupNames(container)).toContain("User");
    expect(namedGroup(container, "User").querySelector('input[placeholder="Search by email or name…"]')).not.toBeNull();

    await pickUser(container, "selected@example.test");
    await act(async () => buttonNamed(container, "Add to group").click());
    await settle();
    await settle();

    const addRequest = requests.find(
      ({ url, method }) => method === "POST" && url.pathname === `/api/v1/groups/${GROUP_ID}/memberships/${userId}`,
    );
    expect(groupMemberAddSchema.omit({ userId: true }).parse(addRequest?.body)).toEqual({
      capacitySelection: { mode: "all_eligible", confirmed: true },
    });
    expect(onChanged).toHaveBeenCalledOnce();
    expect(container.querySelector('input[placeholder="Search by email or name…"]')).toBeNull();
  });

  it("announces a refused add and keeps the form open with the picked person", async () => {
    const userId = "40000000-0000-4000-8000-000000000010";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        if (url.pathname === `/api/v1/groups/${GROUP_ID}/users`) return json(usersPage(userId, "refused@example.test"));
        if ((init.method ?? "GET") === "POST") {
          return new Response(JSON.stringify({ message: "Forbidden" }), { status: 403 });
        }
        return json({ memberships: [], page: { limit: 25, offset: 0, total: 0, hasMore: false } });
      }),
    );
    const onChanged = vi.fn(async () => {});
    const container = mount(<GroupMembers groupId={GROUP_ID} canManage onChanged={onChanged} />);
    await settle();

    await act(async () => buttonNamed(container, "Add person").click());
    await pickUser(container, "refused@example.test");
    await act(async () => buttonNamed(container, "Add to group").click());
    await settle();
    await settle();

    // The refusal is announced rather than left as coloured text, and it is a
    // sentence rather than the transport's own phrasing.
    const alert = [...container.querySelectorAll('[role="alert"]')].find((node) =>
      node.textContent?.includes("You don't have access to this"),
    );
    expect(alert).toBeDefined();
    // A failed add is a retry, not a restart: the form and the pick survive.
    expect(container.querySelector('input[placeholder="Search by email or name…"]')).not.toBeNull();
    expect(buttonNames(container)).toContain("Add to group");
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("reports a failed membership load instead of claiming the group has nobody in it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ message: "Server error" }), { status: 500 })),
    );
    const onChanged = vi.fn(async () => {});
    const container = mount(<GroupMembers groupId={GROUP_ID} canManage onChanged={onChanged} />);
    await settle();

    expect(container.textContent).toContain("on our side");
    // "No matching active membership capacities" is a claim about the group,
    // and the surface does not know that when the request never arrived — so
    // the table is replaced rather than rendered empty beside the error.
    expect(container.textContent).not.toContain("No matching active membership capacities.");
    expect(container.querySelector("caption")).toBeNull();
  });

  it("renders the read-only participant roster instead of the management table when the caller cannot manage", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json({
          memberships: [
            {
              userId: "40000000-0000-4000-8000-000000000002",
              name: "Roster Person",
              headshotUrl: null,
              organizationName: "Roster Organization",
            },
          ],
          page: { limit: 25, offset: 0, total: 1, hasMore: false },
        }),
      ),
    );
    const onChanged = vi.fn(async () => {});
    const container = mount(<GroupMembers groupId={GROUP_ID} canManage={false} onChanged={onChanged} />);
    await settle();

    expect(container.textContent).toContain("Roster Person");
    expect(container.textContent).toContain("Roster Organization");
    // No management affordances: no add-person action and no row commands at
    // all — neither inline buttons nor menus.
    expect([...container.querySelectorAll("button")].some((button) => button.textContent === "Add person")).toBe(false);
    expect(rowActionControlNames(container)).toEqual([]);
  });
});
