// @vitest-environment jsdom
import { render, type ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GroupLeadership } from "../../assets/ts/member-flows/portal/sections/management/GroupLeadership";
import { GroupMembers } from "../../assets/ts/member-flows/portal/sections/management/GroupMembers";
import { GroupMeetings } from "../../assets/ts/member-flows/portal/sections/management/GroupMeetings";

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
          nextOccurrenceAt: "2026-09-01T15:00:00.000Z",
          createdAt: "2026-08-01T00:00:00.000Z",
          updatedAt: "2026-08-01T00:00:00.000Z",
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
    const container = mount(<GroupMeetings groupId={GROUP_ID} />);
    await settle();

    expect(container.textContent).toContain("No matching active meeting series");
    const name = container.querySelector<HTMLInputElement>("#managed-group-meeting-name")!;
    name.value = "Architecture call";
    void act(() => {
      name.dispatchEvent(new Event("input", { bubbles: true }));
    });
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
