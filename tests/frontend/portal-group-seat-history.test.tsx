// @vitest-environment jsdom
import { render, type ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { chooseColumnFilter } from "./helpers/column-menu";
import { controlFor } from "./helpers/labelled-control";
import { afterEach, describe, expect, it, vi } from "vitest";
import { groupMemberAddBodySchema, groupMembershipUpdateSchema } from "../../assets/shared/schemas/groups";
import { GroupMembers } from "../../assets/ts/member-flows/portal/sections/management/GroupMembers";

vi.mock("wouter/use-hash-location", () => ({
  useHashLocation: () => ["", vi.fn()],
}));

const GROUP_ID = "10000000-0000-4000-8000-000000000001";
const SEAT_ID = "50000000-0000-4000-8000-000000000101";
const USER_ID = "40000000-0000-4000-8000-000000000009";
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

function button(container: HTMLElement, label: string): HTMLButtonElement {
  const found = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (candidate) => candidate.textContent === label,
  );
  if (!found) throw new Error(`missing button: ${label}`);
  return found;
}

function setValue(element: HTMLInputElement, value: string): void {
  element.value = value;
  void act(() => {
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function seat(overrides: Record<string, unknown>) {
  return {
    id: SEAT_ID,
    groupId: GROUP_ID,
    userId: "40000000-0000-4000-8000-000000000001",
    identityId: "50000000-0000-4000-8000-000000000011",
    memberId: "50000000-0000-4000-8000-000000000001",
    memberType: "organization",
    userName: "Former Director",
    email: "former@example.test",
    organizationName: "Former Organization",
    membershipCategory: "A",
    source: "staff",
    createdByUserId: null,
    title: "Treasurer",
    joinedAt: "2022-06-01T00:00:00.000Z",
    leftAt: "2025-02-01T00:00:00.000Z",
    ...overrides,
  };
}

const mutation = {
  group: {
    id: GROUP_ID,
    slug: "board",
    name: "Board of Directors",
    type: { key: "board", singularLabel: "Board", pluralLabel: "Boards" },
  },
  memberships: [],
  endedMembershipIds: [],
};

function stubFetch(handle: (url: URL, method: string, body: unknown) => Response) {
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

afterEach(() => {
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
  vi.unstubAllGlobals();
});

describe("portal group seat history", () => {
  it("lists former seats with their service dates and edits a seat through the canonical update route", async () => {
    const requests = stubFetch((url, method) => {
      if (method === "PATCH") return json(mutation);
      // The editor reads its own seat by id; the roster reads a page of them.
      const one = url.searchParams.get("membershipId") === SEAT_ID;
      const former = one || url.searchParams.get("active") === "false";
      return json({
        memberships: former ? [seat({})] : [],
        page: { limit: 25, offset: 0, total: former ? 1 : 0, hasMore: false },
      });
    });
    const container = mount(<GroupMembers groupId={GROUP_ID} canManage onChanged={async () => {}} />);
    await settle();

    expect(container.textContent).toContain("No members yet");
    // Current or former is the Seat column's own filter, so the choice is
    // made where the column is read.
    await chooseColumnFilter(container, "Seat", "Former seats");
    await settle();
    expect(requests.at(-1)?.url.searchParams.get("active")).toBe("false");
    expect(container.textContent).toContain("Former Director");
    expect(container.textContent).toContain("Treasurer");
    expect(container.textContent).toContain("Jun 1, 2022 – Feb 1, 2025");
    // A closed seat can be edited but not ended again.
    const trigger = container.querySelector<HTMLButtonElement>('button[aria-label="Actions for Former Director"]')!;
    await act(async () => trigger.click());
    const items = [...container.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent);
    expect(items).toEqual(["Edit seat"]);

    /*
     * Editing a seat is a page of its own, at the seat's own address, and it
     * loads its subject from there rather than being handed it by the row —
     * so opening it cold shows the same seat, which is what makes the address
     * worth having.
     */
    const editor = mount(
      <GroupMembers groupId={GROUP_ID} canManage seatSegment={SEAT_ID} onChanged={async () => {}} />,
    );
    await settle();
    expect(editor.querySelector("table")).toBeNull();

    expect(editor.textContent).not.toContain("Seat title");
    expect(editor.querySelector('a[href$="/leadership"]')?.textContent).toBe("Leadership");
    setValue(controlFor(editor, "Member until"), "");
    await act(async () => button(editor, "Save seat").click());
    await settle();

    const request = requests.find(
      ({ url, method }) => method === "PATCH" && url.pathname === `/api/v1/groups/${GROUP_ID}/memberships/${SEAT_ID}`,
    );
    expect(groupMembershipUpdateSchema.parse(request?.body)).toEqual({
      joinedAt: "2022-06-01T00:00:00.000Z",
      leftAt: null,
    });
  });

  it("records a former service interval without a competing title", async () => {
    const requests = stubFetch((url, method) => {
      if (url.pathname === `/api/v1/groups/${GROUP_ID}/users`) {
        return json({
          users: [
            {
              id: USER_ID,
              email: "past@example.test",
              first_name: "Past",
              last_name: "Chair",
              organization_name: null,
            },
          ],
          page: { limit: 8, offset: 0, total: 1, hasMore: false },
        });
      }
      if (method === "POST") return json(mutation);
      return json({ memberships: [], page: { limit: 25, offset: 0, total: 0, hasMore: false } });
    });
    // Adding is a page of its own, under the reserved `add` segment.
    const container = mount(<GroupMembers groupId={GROUP_ID} canManage seatSegment="add" onChanged={async () => {}} />);
    await settle();

    const picker = container.querySelector<HTMLInputElement>('input[placeholder="Search by email or name…"]')!;
    setValue(picker, "past@example.test");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 350));
    });
    await settle();
    const result = [...container.querySelectorAll<HTMLButtonElement>("button")].find((candidate) =>
      candidate.textContent?.includes("past@example.test"),
    )!;
    await act(async () => result.click());

    expect(container.textContent).not.toContain("Seat title");
    setValue(controlFor(container, "Member since"), "2022-06-01");
    /*
     * The end date is a plain optional field now, not something a checkbox
     * has to unhide first (#34). Filling it is what makes this a former
     * seat — including what the submit button then offers to do.
     */
    expect(container.querySelector('input[type="checkbox"]')).toBeNull();
    setValue(controlFor(container, "Member until"), "2025-02-01");
    await act(async () => button(container, "Record former seat").click());
    await settle();

    const request = requests.find(
      ({ url, method }) => method === "POST" && url.pathname === `/api/v1/groups/${GROUP_ID}/memberships/${USER_ID}`,
    );
    expect(groupMemberAddBodySchema.parse(request?.body)).toEqual({
      capacitySelection: { mode: "all_eligible", confirmed: true },
      joinedAt: "2022-06-01T00:00:00.000Z",
      leftAt: "2025-02-01T00:00:00.000Z",
    });
  });
});
