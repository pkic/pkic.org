// @vitest-environment jsdom
import { render, type JSX } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GroupWorkspace } from "../../assets/ts/member-flows/portal/sections/management/GroupWorkspace";
import { isCurrentTab, tabNamed, tabNames } from "./helpers/tabs";

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
    publicRoster: false,
    minEndorsersForBallot: 2,
    active: true,
    revision,
    membershipCapacityCount: 4,
    representedMemberCount: 3,
    participantCount: 3,
    childCount: 1,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  } as const;
}

function configuration(revision = 0) {
  return {
    governanceInheritanceMode: "inherited",
    eligibilityMode: "managed",
    automaticEnrollmentMode: "none",
    allowAutomaticOptOut: false,
    minEndorsersForBallot: 2,
    revision,
  } as const;
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

async function settle(): Promise<void> {
  // Two rounds: one for the group-detail fetch, one for the lazily imported view.
  for (let round = 0; round < 3; round += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

// The workspace lazy-loads its tab views; warm the module graph so the lazy
// import resolves within the act() flushes above instead of stalling on a
// cold vitest transform.
beforeEach(async () => {
  await import("../../assets/ts/member-flows/portal/sections/management/GroupOverview");
  await import("../../assets/ts/member-flows/portal/sections/management/GroupSettingsForm");
  await import("../../assets/ts/member-flows/portal/sections/management/GroupCategoryRulesEditor");
});

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

describe("portal selected-group workspace", () => {
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
        if (url.pathname === `/api/v1/groups/${GROUP_ID}` && method === "GET") {
          return json({
            group: group(revision),
            capabilities: ["view", "manage"],
            configuration: configuration(revision),
          });
        }
        if (url.pathname === `/api/v1/groups/${GROUP_ID}/category-rules` && method === "GET") {
          return json({ groupId: GROUP_ID, revision, rules: [] });
        }
        if (url.pathname === "/api/v1/members/applications/form" && method === "GET") {
          return json({
            categories: [
              {
                code: "A",
                label: "Category A",
                description: null,
                displayOrder: 1,
                isIndividual: false,
                isVoting: true,
              },
            ],
            form: null,
          });
        }
        if (url.pathname === `/api/v1/groups/${GROUP_ID}` && method === "PATCH") {
          revision += 1;
          return json({ group: group(revision) });
        }
        throw new Error(`Unexpected request: ${method} ${url.pathname}`);
      }),
    );

    await act(() => render(<GroupWorkspace groupId={GROUP_ID} view="settings" />, container));
    await settle();

    expect(container.textContent).toContain("Architecture Committee");
    expect(container.textContent).toContain("Part of Parent Group");
    // The headline counts live on the overview's about panel now, not in the
    // page header repeated above every view.
    expect(container.textContent).not.toContain("Members represented");
    expect(requests.some(({ url }) => url.pathname.includes("working-groups"))).toBe(false);
    // The group workspace is route-addressed; no manageable-group picker request is made.
    expect(requests.some(({ url }) => url.searchParams.get("manageable") === "true")).toBe(false);
    expect(requests.some(({ url }) => url.pathname === `/api/v1/groups/${GROUP_ID}`)).toBe(true);
    expect(requests.some(({ url }) => url.pathname === `/api/v1/groups/${GROUP_ID}/context`)).toBe(false);
    expect(requests.some(({ url }) => url.searchParams.has("manageable") && url.pathname.includes(GROUP_ID))).toBe(
      false,
    );

    // The design-system Field owns the control's id, so the input is found
    // the way a reader finds it: through the label that points at it.
    const nameLabel = [...container.querySelectorAll("label")].find((label) => label.textContent?.startsWith("Name"))!;
    expect(nameLabel.htmlFor).not.toBe("");
    const name = container.querySelector<HTMLInputElement>(`[id="${nameLabel.htmlFor}"]`)!;
    expect(name).not.toBeNull();
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
        if (url.pathname === `/api/v1/groups/${GROUP_ID}`) {
          return json({ group: group(), capabilities: ["view", "participate"] });
        }
        const page = { limit: 3, offset: 0, total: 0, hasMore: false };
        if (url.pathname === `/api/v1/groups/${GROUP_ID}/events`) return json({ events: [], page });
        if (url.pathname === `/api/v1/groups/${GROUP_ID}/votes`) return json({ votes: [], page });
        throw new Error(`Unexpected request: ${url.pathname}`);
      }),
    );

    await act(() => render(<GroupWorkspace groupId={GROUP_ID} view="overview" />, container));
    await settle();

    expect(tabNames(container)).toEqual([
      "Overview",
      "Members",
      "Events",
      "Meetings",
      "Votes",
      "Forms",
      "Mailing lists",
    ]);
    expect(container.textContent).toContain("You participate in this group.");
    expect(container.textContent).not.toContain("Save group settings");
  });

  it("names the workspace context and the section strip for a reader who cannot see them", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        if (url.pathname === `/api/v1/groups/${GROUP_ID}`) {
          return json({ group: { ...group(), active: false }, capabilities: ["view", "participate"] });
        }
        throw new Error(`Unexpected request: ${url.pathname}`);
      }),
    );

    await act(() => render(<GroupWorkspace groupId={GROUP_ID} view="overview" />, container));
    await settle();

    // The page header is a labelled region, so the context a reader lands in
    // can be reached by landmark rather than being one more unlabelled box.
    const context = container.querySelector("header[aria-labelledby]")!;
    expect(context).not.toBeNull();
    expect(context.querySelector("h2")?.textContent).toBe("Architecture Committee");
    // The trail leads back to the catalog.
    const trailLink = container.querySelector<HTMLAnchorElement>('nav[aria-label="Breadcrumb"] a');
    expect(trailLink?.getAttribute("href")).toBe("#/groups");

    // The strip says which set of sections it is, and the current one is
    // marked rather than merely coloured.
    const strip = container.querySelector('nav[aria-label$=" sections"]')!;
    expect(strip.getAttribute("aria-label")).toBe("Architecture Committee sections");
    expect(isCurrentTab(tabNamed(container, "Overview"))).toBe(true);
    expect(isCurrentTab(tabNamed(container, "Members"))).toBe(false);

    // An inactive group says the word as well as showing the tone.
    expect(context.textContent).toContain("Inactive");
  });

  it("reports a failed group load instead of rendering an empty workspace", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json({ error: { code: "GROUP_NOT_VISIBLE", message: "This group is not visible to you." } }, 404),
      ),
    );

    await act(() => render(<GroupWorkspace groupId={GROUP_ID} view="overview" />, container));
    await settle();

    expect(container.querySelector('[role="alert"]')?.textContent).toContain("This group is not visible to you.");
    expect(container.querySelector("header[aria-labelledby]")).toBeNull();
    expect(tabNames(container)).toEqual([]);
  });

  it("refuses a section the identity's capabilities do not grant", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        if (url.pathname === `/api/v1/groups/${GROUP_ID}`) {
          return json({ group: group(), capabilities: ["view"] });
        }
        throw new Error(`Unexpected request: ${url.pathname}`);
      }),
    );

    await act(() => render(<GroupWorkspace groupId={GROUP_ID} view="audit" />, container));
    await settle();

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "This group section is not available to your current identity.",
    );
    expect(tabNames(container)).toEqual(["Overview"]);
  });
});
