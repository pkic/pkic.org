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
  it("lists and creates recurring meetings only through canonical group routes", async () => {
    const requests: Array<{ url: URL; method: string; body?: unknown }> = [];
    let created = false;
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
        const series = {
          id: "60000000-0000-4000-8000-000000000001",
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
          inviteWindow: {
            startsAt: null,
            endsAt: null,
            timezone: "Europe/Amsterdam",
          },
          nextOccurrenceAt: "2026-09-01T15:00:00.000Z",
          createdAt: "2026-08-01T00:00:00.000Z",
          updatedAt: "2026-08-01T00:00:00.000Z",
          capabilities: ["view", "register", "attend", "manage_attendance", "manage"],
          occurrenceCount: 0,
        } as const;
        if (method === "POST") {
          created = true;
          return json({ series });
        }
        return json({
          series: created ? [series] : [],
          page: { limit: 25, offset: 0, total: created ? 1 : 0, hasMore: false },
        });
      }),
    );
    const container = mount(<GroupMeetings groupId={GROUP_ID} canManage />);
    await settle();

    expect(container.textContent).toContain("No meeting series yet");
    // The create form is absent until it is asked for, and present once it
    // is — said by the name the reader would look for, not by an id.
    expect(labelNames(container)).not.toContain("Meeting name");
    const newSeries = [...container.querySelectorAll("button")].find((button) => button.textContent === "New series")!;
    await act(async () => newSeries.click());
    expect(labelNames(container)).toContain("Meeting name");
    await typeInto(controlFor(container, "Meeting name"), "Architecture call");
    await settle();
    const create = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Create meeting series",
    )!;
    await act(async () => create.click());
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
    expect(container.textContent).toContain("Architecture call");
    expect(container.querySelector<HTMLAnchorElement>("a[href$='/calendar.ics']")?.href).toContain(
      `/api/v1/groups/${GROUP_ID}/meetings/series/60000000-0000-4000-8000-000000000001/calendar.ics`,
    );
    expect(requests.some(({ url }) => url.pathname.includes("working-groups"))).toBe(false);
    expect(requests.some(({ url }) => url.pathname.includes("/admin/"))).toBe(false);
  });

  it("navigates to and from a meeting series' canonical URL when its detail is opened and closed", async () => {
    const seriesId = "60000000-0000-4000-8000-000000000001";
    const series = {
      id: seriesId,
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
      capabilities: ["view", "manage"],
      occurrenceCount: 0,
    } as const;
    const page = { limit: 25, offset: 0, total: 1, hasMore: false };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        if (url.pathname.endsWith("/occurrences")) return json({ occurrences: [], page });
        return json({ series: [series], page });
      }),
    );

    const container = mount(<GroupMeetings groupId={GROUP_ID} canManage />);
    await settle();
    const details = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Details");
    await act(async () => {
      details?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await settle();
    expect(navigate).toHaveBeenCalledWith(`/groups/${GROUP_ID}/meetings/${seriesId}`);

    const hide = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Hide");
    await act(async () => {
      hide?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await settle();
    expect(navigate).toHaveBeenCalledWith(`/groups/${GROUP_ID}/meetings`);
  });

  it("opens a meeting series from its URL-addressed initial series and reports a failed occurrences fetch", async () => {
    const seriesId = "60000000-0000-4000-8000-000000000001";
    const series = {
      id: seriesId,
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
      capabilities: ["view", "manage"],
      occurrenceCount: 0,
    } as const;
    const page = { limit: 25, offset: 0, total: 1, hasMore: false };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        if (url.pathname.endsWith("/occurrences")) {
          return new Response(JSON.stringify({ message: "Server error" }), { status: 500 });
        }
        return json({ series: [series], page });
      }),
    );

    const container = mount(<GroupMeetings groupId={GROUP_ID} canManage initialSeriesId={seriesId} />);
    await settle();
    await settle();

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
    expect(container.querySelector("section")?.getAttribute("aria-label")).toBe("Membership capacities");
    expect(container.querySelector("caption")?.textContent).toBe("Active membership capacities in this group");
    // The actions column names each row's subject instead of the control.
    expect(container.querySelector('button[aria-label="Actions for Member Person"]')).not.toBeNull();

    // The search box is reached through its own `for`/`id` pair, so this
    // lookup fails exactly when the labelling does.
    const search = controlFor(container, "Search membership capacities");
    await typeInto(search, "member@example.test");
    await settle();
    void act(() => {
      search.form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await settle();
    expect(requests.at(-1)?.url.searchParams.get("q")).toBe("member@example.test");

    await openRowMenu(container, "Actions for Member Person");
    await act(async () => menuItem(container, "Remove").click());
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
    // No management affordances: no add-person action and no per-row menu.
    expect([...container.querySelectorAll("button")].some((button) => button.textContent === "Add person")).toBe(false);
    expect(container.querySelector('button[aria-label^="Actions for"]')).toBeNull();
  });
});
