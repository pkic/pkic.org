// @vitest-environment jsdom
import { render, type JSX } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Management } from "../../assets/ts/member-flows/portal/sections/management/Management";

const GROUP_ID = "10000000-0000-4000-8000-000000000001";
const navigate = vi.fn();

vi.mock("wouter", () => ({
  Link: ({ children, href, ...props }: JSX.HTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={`#${href}`} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("wouter/use-hash-location", () => ({
  useHashLocation: () => ["/groups/10000000-0000-4000-8000-000000000001/settings", navigate],
}));

function group(revision = 0) {
  return {
    id: GROUP_ID,
    slug: "architecture",
    name: "Architecture Committee",
    type: { key: "committee", singularLabel: "Committee", pluralLabel: "Committees" },
    parentGroup: {
      id: "10000000-0000-4000-8000-000000000002",
      slug: "parent",
      name: "Parent Group",
      type: { key: "working_group", singularLabel: "Working Group", pluralLabel: "Working Groups" },
    },
    description: "Coordinates platform architecture.",
    links: ["https://github.com/pkic"],
    visibility: "participants",
    governanceInheritanceMode: "inherited",
    eligibilityMode: "managed",
    automaticEnrollmentMode: "none",
    allowAutomaticOptOut: false,
    publicLeadership: false,
    minEndorsersForBallot: 2,
    active: true,
    revision,
    membershipCapacityCount: 4,
    participantCount: 3,
    childCount: 1,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  } as const;
}

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

let container: HTMLDivElement;

beforeEach(() => {
  navigate.mockReset();
  container = document.createElement("div");
  document.body.append(container);
});

afterEach(() => {
  void act(() => render(null, container));
  container.remove();
  vi.unstubAllGlobals();
});

describe("portal selected-group management", () => {
  it("loads one server-derived group context and updates through the canonical group route", async () => {
    const requests: Array<{ url: URL; method: string; body?: unknown }> = [];
    let revision = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        const method = init.method ?? "GET";
        requests.push({ url, method, body: typeof init.body === "string" ? JSON.parse(init.body) : undefined });
        if (url.pathname === "/api/v1/groups" && method === "GET") {
          return json({
            groups: [group(revision)],
            page: { limit: 25, offset: 0, total: 1, hasMore: false },
          });
        }
        if (url.pathname === `/api/v1/groups/${GROUP_ID}` && method === "GET") {
          return json({ group: group(revision) });
        }
        if (url.pathname === `/api/v1/groups/${GROUP_ID}/context` && method === "GET") {
          return json({ group: group(revision), capabilities: ["view", "manage"] });
        }
        if (url.pathname === `/api/v1/groups/${GROUP_ID}` && method === "PATCH") {
          revision += 1;
          return json({ group: group(revision) });
        }
        throw new Error(`Unexpected request: ${method} ${url.pathname}`);
      }),
    );

    await act(() => render(<Management groupId={GROUP_ID} view="settings" />, container));
    await settle();

    expect(container.textContent).toContain("Architecture Committee");
    expect(container.textContent).toContain("Part of Parent Group");
    expect(container.textContent).toContain("Membership capacities");
    expect(requests.some(({ url }) => url.pathname.includes("working-groups"))).toBe(false);
    expect(
      requests.some(({ url }) => url.pathname === "/api/v1/groups" && url.searchParams.get("manageable") === "true"),
    ).toBe(true);
    expect(requests.some(({ url }) => url.pathname === `/api/v1/groups/${GROUP_ID}/context`)).toBe(true);
    expect(requests.some(({ url }) => url.searchParams.has("manageable") && url.pathname.includes(GROUP_ID))).toBe(
      false,
    );

    const name = container.querySelector<HTMLInputElement>("#managed-group-name")!;
    name.value = "Architecture and Design Committee";
    void act(() => {
      name.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const save = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Save group settings",
    )!;
    await act(async () => save.click());
    await settle();

    const update = requests.find(({ method }) => method === "PATCH");
    expect(update?.url.pathname).toBe(`/api/v1/groups/${GROUP_ID}`);
    expect(update?.body).toMatchObject({
      expectedRevision: 0,
      name: "Architecture and Design Committee",
      links: ["https://github.com/pkic"],
    });
    expect(container.textContent).toContain("Group settings updated.");
  });

  it("shows only sections backed by the selected identity's live capabilities", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        if (url.pathname === `/api/v1/groups/${GROUP_ID}/context`) {
          return json({ group: group(), capabilities: ["view", "participate"] });
        }
        throw new Error(`Unexpected request: ${url.pathname}`);
      }),
    );

    await act(() => render(<Management groupId={GROUP_ID} view="overview" />, container));
    await settle();

    const tabs = [...container.querySelectorAll("nav a")].map((link) => link.textContent);
    expect(tabs).toEqual(["Overview", "Meetings"]);
    expect(container.textContent).not.toContain("Save group settings");
  });
});
