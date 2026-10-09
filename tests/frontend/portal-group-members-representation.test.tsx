// @vitest-environment jsdom
/**
 * The roster's Representation panel counts the whole group, not the page.
 *
 * A search that matches nobody empties the table, and the people and
 * organizations the group has stay what they were: the panel answers a
 * different question from the table beside it, so narrowing the table must
 * not move it.
 */
import { render, type ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { groupStatsResponseSchema } from "../../assets/shared/schemas/group-statistics";
import { GroupMembers } from "../../assets/ts/member-flows/portal/sections/management/GroupMembers";
import { controlFor, typeInto } from "./helpers/labelled-control";

vi.mock("wouter/use-hash-location", () => ({ useHashLocation: () => ["", vi.fn()] }));
vi.mock("wouter", () => ({
  Link: ({ children, href }: { children?: ComponentChildren; href: string }) => <a href={`#${href}`}>{children}</a>,
}));

const GROUP_ID = "10000000-0000-4000-8000-000000000001";

const stats = groupStatsResponseSchema.parse({
  group: {
    id: GROUP_ID,
    slug: "architecture",
    name: "Architecture",
    type: { key: "working_group", singularLabel: "Working group", pluralLabel: "Working groups" },
  },
  generatedAt: "2026-08-26T12:00:00.000Z",
  scope: "current",
  window: { from: null, to: "2026-08-26T12:00:00.000Z" },
  participation: { people: { count: 2 }, organizations: { count: 1 }, capacities: { count: 2 } },
  activity: { people: { actorCount: 0, actionCount: 0 }, capacities: { joinedCount: 0, leftCount: 0 } },
});

const seat = (index: number) => ({
  id: `20000000-0000-4000-8000-00000000000${index}`,
  groupId: GROUP_ID,
  userId: `40000000-0000-4000-8000-00000000000${index}`,
  identityId: `50000000-0000-4000-8000-00000000001${index}`,
  memberId: `50000000-0000-4000-8000-00000000000${index}`,
  memberType: "organization",
  userName: `Representation user ${index}`,
  email: `user-${index}@example.test`,
  headshotUrl: null,
  organizationName: "Representation organization",
  membershipCategory: "F",
  source: "staff",
  createdByUserId: null,
  title: null,
  joinedAt: "2026-08-01T00:00:00.000Z",
  leftAt: null,
});

const mounted: HTMLElement[] = [];

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
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

describe("group roster representation", () => {
  it("keeps the whole group's people and organizations when a search empties the table", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(String(input), location.origin);
        if (url.pathname.endsWith("/stats")) return json(stats);
        const matches = url.searchParams.get("q") ? [] : [seat(1), seat(2)];
        return json({ memberships: matches, page: { limit: 25, offset: 0, total: matches.length, hasMore: false } });
      }),
    );
    const container = document.createElement("div");
    document.body.append(container);
    mounted.push(container);
    await act(() => render(<GroupMembers groupId={GROUP_ID} canManage onChanged={async () => undefined} />, container));
    await settle();
    await settle();

    const counts = () =>
      ["People", "Organizations"].map(
        (label) => container.querySelector(`[role="group"][aria-label="${label}"]`)?.textContent ?? "",
      );
    expect(container.querySelectorAll("tbody tr")).toHaveLength(2);
    expect(counts()).toEqual(["People2", "Organizations1"]);

    const search = controlFor(container, "Search members");
    await typeInto(search, "no matching user");
    await act(async () => {
      search.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    await settle();

    expect(container.textContent).toContain("No members to show");
    expect(container.querySelectorAll("tbody tr")).toHaveLength(0);
    expect(counts()).toEqual(["People2", "Organizations1"]);
  });
});
