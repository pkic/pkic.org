// @vitest-environment jsdom
/**
 * Faithful reproduction harness for the duplicated-workspace symptom seen
 * live: switching between groups in the sidebar and between views (including
 * URL-addressed event sub-resources) re-renders the real GroupWorkspace with
 * new props, exactly as wouter's route params do. At every step the DOM must
 * hold exactly one workspace context header, and its content must follow the
 * requested group and view — including while a lazy view chunk is pending.
 */
import { render, type JSX } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GroupWorkspace } from "../../assets/ts/member-flows/portal/sections/management/GroupWorkspace";

const GROUP_X = "10000000-0000-4000-8000-00000000000a";
const GROUP_Y = "10000000-0000-4000-8000-00000000000b";
const navigate = vi.fn();

vi.mock("wouter", () => ({
  Link: ({ children, href, ...props }: JSX.HTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={`#${href}`} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("wouter/use-hash-location", () => ({
  useHashLocation: () => ["/groups/current", navigate],
}));

// A deliberately slow lazy view: statistics resolves only when released, so a
// navigation can happen while its chunk is still pending — the sequence a
// user clicking quickly through the sidebar produces.
let releaseStatistics: (() => void) | null = null;
vi.mock("../../assets/ts/member-flows/portal/sections/management/GroupStatistics", () => {
  return new Promise((resolve) => {
    releaseStatistics = () =>
      resolve({ GroupStatistics: ({ groupId }: { groupId: string }) => <p>{`statistics for ${groupId}`}</p> });
  });
});

function group(id: string, name: string) {
  return {
    id,
    slug: name.toLowerCase().replace(/\s+/g, "-"),
    name,
    type: { key: "working_group", singularLabel: "Working Group", pluralLabel: "Working Groups" },
    parentGroup: null,
    description: `${name} coordinates its own work.`,
    links: [],
    visibility: "participants",
    governanceInheritanceMode: "inherited",
    eligibilityMode: "managed",
    automaticEnrollmentMode: "none",
    allowAutomaticOptOut: false,
    publicLeadership: false,
    publicRoster: false,
    minEndorsersForBallot: 2,
    active: true,
    revision: 0,
    membershipCapacityCount: 4,
    representedMemberCount: 3,
    participantCount: 3,
    childCount: 0,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  };
}

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
}

const emptyPage = { limit: 50, offset: 0, total: 0, hasMore: false };

function stubApi(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), location.origin);
      if (/^\/api\/v1\/groups\/[^/]+$/.test(url.pathname)) {
        const id = url.pathname.split("/").pop()!;
        const name = id === GROUP_X ? "Alpha Working Group" : "Beta Working Group";
        return json({
          group: group(id, name),
          capabilities: ["view", "participate", "manage"],
          configuration: {
            governanceInheritanceMode: "inherited",
            eligibilityMode: "managed",
            automaticEnrollmentMode: "none",
            allowAutomaticOptOut: false,
            minEndorsersForBallot: 2,
            revision: 0,
          },
        });
      }
      if (url.pathname.endsWith("/votes")) return json({ votes: [], page: emptyPage });
      if (url.pathname.endsWith("/events")) return json({ events: [], page: emptyPage });
      if (url.pathname.includes("/users/current/groups")) return json({ groups: [], page: emptyPage });
      return json({ page: emptyPage });
    }),
  );
}

async function settle(): Promise<void> {
  for (let round = 0; round < 3; round += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

beforeEach(async () => {
  await import("../../assets/ts/member-flows/portal/sections/management/GroupOverview");
  await import("../../assets/ts/member-flows/portal/sections/management/GroupVotes");
  await import("../../assets/ts/member-flows/portal/sections/management/GroupEvents");
});

let container: HTMLDivElement;

beforeEach(() => {
  stubApi();
  container = document.createElement("div");
  document.body.append(container);
});

afterEach(() => {
  void act(() => render(null, container));
  container.remove();
  vi.unstubAllGlobals();
});

function contexts(): string[] {
  return [...container.querySelectorAll(".portal-management-context")].map(
    (node) => node.querySelector("h4")?.textContent ?? "",
  );
}

describe("group workspace switching", () => {
  it("keeps one workspace and follows the group when the sidebar switches groups", async () => {
    await act(() => render(<GroupWorkspace groupId={GROUP_X} view="votes" />, container));
    await settle();
    expect(contexts()).toEqual(["Alpha Working Group"]);

    // Sidebar click: same route pattern, new groupId param.
    await act(() => render(<GroupWorkspace groupId={GROUP_Y} view="votes" />, container));
    await settle();
    expect(contexts()).toEqual(["Beta Working Group"]);
  });

  it("keeps one workspace across view switches including event sub-resources", async () => {
    await act(() => render(<GroupWorkspace groupId={GROUP_X} view="votes" />, container));
    await settle();
    await act(() => render(<GroupWorkspace groupId={GROUP_X} view="overview" />, container));
    await settle();
    expect(contexts()).toEqual(["Alpha Working Group"]);
    expect(container.textContent).toContain("About this group");

    await act(() => render(<GroupWorkspace groupId={GROUP_X} view="events" resourceId="EV1" />, container));
    await settle();
    expect(contexts()).toEqual(["Alpha Working Group"]);
  });

  it("never shows the previous group's workspace or tab links while the next group loads", async () => {
    let releaseDetail: (() => void) | null = null;
    const baseFetch = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input), location.origin);
        if (url.pathname === `/api/v1/groups/${GROUP_Y}`) {
          await new Promise<void>((resolve) => {
            releaseDetail = resolve;
          });
        }
        return baseFetch(input, init);
      }),
    );

    await act(() => render(<GroupWorkspace groupId={GROUP_X} view="overview" />, container));
    await settle();
    expect(contexts()).toEqual(["Alpha Working Group"]);

    // Sidebar switch: group Y's detail hangs. The fast click a user makes on
    // a tab right now must not find a link into group X.
    await act(() => render(<GroupWorkspace groupId={GROUP_Y} view="overview" />, container));
    await settle();
    expect(contexts()).toEqual([]);
    const staleTabLinks = [...container.querySelectorAll("nav.nav-tabs a")].filter((link) =>
      link.getAttribute("href")?.includes(GROUP_X),
    );
    expect(staleTabLinks).toEqual([]);
    expect(container.textContent).toContain("Loading group…");

    await act(() => {
      releaseDetail?.();
    });
    await settle();
    expect(contexts()).toEqual(["Beta Working Group"]);
    const tabHrefs = [...container.querySelectorAll("nav.nav-tabs a")].map((link) => link.getAttribute("href"));
    expect(tabHrefs.length).toBeGreaterThan(0);
    for (const href of tabHrefs) {
      expect(href).toContain(GROUP_Y);
    }
  });

  it("keeps one workspace when navigating away while a view chunk is still pending", async () => {
    await act(() => render(<GroupWorkspace groupId={GROUP_X} view="overview" />, container));
    await settle();

    // Statistics suspends (module withheld); bounce to another group's votes
    // before it resolves, then release the chunk.
    await act(() => render(<GroupWorkspace groupId={GROUP_X} view="stats" />, container));
    await act(() => render(<GroupWorkspace groupId={GROUP_Y} view="overview" />, container));
    await settle();
    await act(() => {
      releaseStatistics?.();
    });
    await settle();

    expect(contexts()).toEqual(["Beta Working Group"]);
    expect(container.textContent).not.toContain("statistics for");
  });
});
