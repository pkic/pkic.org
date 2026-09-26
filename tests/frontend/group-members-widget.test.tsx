// @vitest-environment jsdom
/**
 * The member organizations a charter page names.
 *
 * The row used to be a build-time loop over `data/members/*.yaml` filtered by
 * a `workingGroups` field, so it listed whoever was in a file rather than
 * whoever is in the group (#8). What is asserted here is what a visual review
 * cannot see: that it reads the canonical members roll narrowed to the group,
 * links each member the way the members directory does, and stays out of the
 * way of a page that is perfectly readable without it.
 */
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GroupMembersWidget } from "../../assets/ts/member-flows/group-members-widget";

const containers: HTMLElement[] = [];

function mount(): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  containers.push(container);
  void act(() => render(<GroupMembersWidget apiBase="/api/v1" slug="pqc" />, container));
  return container;
}

function membersPage(members: unknown[]): Response {
  return Response.json({
    members,
    page: { limit: 100, offset: 0, total: members.length, hasMore: false },
  });
}

/** One row of the public roll, as the members list returns it. */
function member(overrides: Record<string, unknown>) {
  return {
    id: "o1",
    slug: null,
    name: "Member",
    memberType: "organization",
    tier: null,
    memberSince: "2020-01-01",
    website: null,
    description: null,
    slogan: null,
    logoUrl: null,
    ...overrides,
  };
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

afterEach(() => {
  for (const container of containers.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
  vi.unstubAllGlobals();
});

describe("GroupMembersWidget", () => {
  it("names each member from the group's own directory, in the order it returns them", async () => {
    const requests: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        requests.push(String(input));
        return membersPage([
          member({ id: "o1", slug: "acme-corp", name: "Acme Corp", website: "https://acme.test" }),
          member({ id: "o2", name: "Bravo Ltd", website: "https://bravo.test" }),
          member({ id: "o3", name: "Charlie GmbH" }),
        ]);
      }),
    );

    const container = mount();
    await settle();

    // The canonical roll, narrowed to the group and to the organizations a
    // charter row names — not a second query that answers the same question.
    // Asserted on the query rather than on the string: which endpoint is
    // asked and how it is narrowed is the contract; the order the parameters
    // happen to be serialized in is not.
    expect(requests).toHaveLength(1);
    const asked = new URL(requests[0], "https://example.test");
    expect(asked.pathname).toBe("/api/v1/members");
    expect(Object.fromEntries(asked.searchParams)).toEqual({
      workingGroup: "pqc",
      group: "organization",
      limit: "100",
      sort: "name",
    });
    /*
     * Every name goes to the same place the directory and the wall send it —
     * this member's page on this site (#15). It used to leave for the
     * organization's own website when there was no slug, and drop the link
     * entirely when there was no website either, so one row of a charter
     * table behaved differently from the row beside it.
     */
    expect([...container.querySelectorAll("a")].map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
      ["Acme Corp", "/members/acme-corp/"],
      ["Bravo Ltd", "/members/profile/?id=o2"],
      ["Charlie GmbH", "/members/profile/?id=o3"],
    ]);
    expect(container.textContent).toBe("Acme Corp, Bravo Ltd, Charlie GmbH");
  });

  it("renders nothing at all when the group has no members yet", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => membersPage([])),
    );
    const container = mount();
    await settle();
    // Not "None" and not an empty-state box: this sits inside a table cell on
    // a charter page, and a sentence about absence is worse than a blank.
    expect(container.textContent).toBe("");
  });

  it("leaves the cell blank when the roll cannot be read", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 503 })),
    );
    const container = mount();
    await settle();
    // A charter is readable without its member row; an error inside a table
    // cell is not something a reader of a charter can act on.
    expect(container.textContent).toBe("");
  });
});
