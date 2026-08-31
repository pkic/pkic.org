import { render, type JSX } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PortalNavigationShell } from "../../assets/ts/member-flows/portal/shell/PortalNavigationShell";
import { portalSessionFixture } from "../helpers/portal-session";

vi.mock("wouter", () => ({
  Link: ({ children, href, ...props }: JSX.HTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={`#${href}`} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("wouter/use-hash-location", () => ({
  useHashLocation: () => ["/groups", vi.fn()],
}));

let container: HTMLDivElement;

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
}

function emptyPage(key: string): unknown {
  return { [key]: [], page: { limit: 12, offset: 0, total: 0, hasMore: false } };
}

function group(id: string, name: string): Record<string, unknown> {
  return {
    id,
    slug: name.toLowerCase().replace(/\s+/g, "-"),
    name,
    type: { key: "working_group", singularLabel: "Working Group", pluralLabel: "Working Groups" },
    parentGroup: null,
    description: null,
    links: [],
    visibility: "participants",
    governanceInheritanceMode: "inherited",
    eligibilityMode: "open",
    automaticEnrollmentMode: "none",
    allowAutomaticOptOut: true,
    publicLeadership: false,
    minEndorsersForBallot: 0,
    active: true,
    revision: 0,
    membershipCapacityCount: 1,
    participantCount: 1,
    childCount: 0,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  };
}

beforeEach(() => {
  window.location.hash = "#/groups";
  container = document.createElement("div");
  document.body.append(container);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
        location.origin,
      );
      if (url.pathname === "/api/v1/users/current/groups") return json(emptyPage("groups"));
      if (url.pathname === "/api/v1/users/current/organizations") return json(emptyPage("organizations"));
      if (url.pathname === "/api/v1/groups") return json(emptyPage("groups"));
      throw new Error(`Unexpected request: ${url.pathname}`);
    }),
  );
});

afterEach(() => {
  void act(() => render(null, container));
  container.remove();
  window.location.hash = "";
  vi.unstubAllGlobals();
});

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function mountNavigation(session = portalSessionFixture({ staff: true }), headshotUrl: string | null = null): void {
  void act(() =>
    render(
      <PortalNavigationShell session={session} displayName="Portal Tester" headshotUrl={headshotUrl}>
        <p>Page content</p>
      </PortalNavigationShell>,
      container,
    ),
  );
}

describe("portal navigation shell", () => {
  it("exposes one labelled navigation and controlled mobile drawer", async () => {
    mountNavigation();
    await settle();
    const toggle = container.querySelector<HTMLButtonElement>("#portal-sidebar-toggle")!;
    const sidebar = container.querySelector<HTMLElement>("#portal-sidebar")!;
    const backdrop = container.querySelector<HTMLButtonElement>("#portal-sidebar-backdrop")!;

    expect(sidebar.getAttribute("aria-label")).toBe("Portal navigation");
    expect(toggle.getAttribute("aria-label")).toBe("Open navigation");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(backdrop.getAttribute("aria-label")).toBe("Close navigation");

    void act(() => toggle.click());
    expect(toggle.getAttribute("aria-label")).toBe("Close navigation");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(sidebar.classList.contains("open")).toBe(true);
    expect(backdrop.classList.contains("active")).toBe(true);

    void act(() => backdrop.click());
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(sidebar.classList.contains("open")).toBe(false);
  });

  it("closes on Escape and restores focus to the drawer control", async () => {
    mountNavigation();
    await settle();
    const toggle = container.querySelector<HTMLButtonElement>("#portal-sidebar-toggle")!;

    void act(() => toggle.click());
    void act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });

    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(toggle);
  });

  it("lists the identity's groups under the Groups entry without authority annotations", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
        location.origin,
      );
      if (url.pathname === "/api/v1/users/current/groups") {
        expect(url.searchParams.get("view")).toBe("joined");
        return json({
          groups: [
            {
              ...group("10000000-0000-4000-8000-000000000001", "Architecture"),
              eligibleCapacities: [],
              memberships: [
                {
                  id: "20000000-0000-4000-8000-000000000001",
                  memberId: "30000000-0000-4000-8000-000000000001",
                  memberType: "organization",
                  organizationName: "Example Org",
                  source: "self_service",
                  joinedAt: "2026-08-01T00:00:00.000Z",
                  membershipCategory: "A",
                },
              ],
            },
          ],
          page: { limit: 12, offset: 0, total: 1, hasMore: false },
        });
      }
      if (url.pathname === "/api/v1/groups") {
        expect(url.searchParams.get("manageable")).toBe("true");
        return json({
          groups: [
            group("10000000-0000-4000-8000-000000000001", "Architecture"),
            group("10000000-0000-4000-8000-000000000002", "Coordination"),
          ],
          page: { limit: 12, offset: 0, total: 2, hasMore: false },
        });
      }
      if (url.pathname === "/api/v1/users/current/organizations") return json(emptyPage("organizations"));
      throw new Error(`Unexpected request: ${url.pathname}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    mountNavigation(portalSessionFixture({ staff: true, member: true }));
    await settle();
    await settle();

    const groupsList = container.querySelector(".portal-sidebar-groups")!;
    expect(groupsList).toBeTruthy();
    const entries = [...groupsList.querySelectorAll("a")].map((link) => link.textContent);
    expect(entries).toEqual(["Architecture", "Coordination"]);
    // The menu navigates; role and permission details belong to the account view.
    expect(groupsList.querySelector(".portal-sidebar-group-role")).toBeNull();
  });

  it("keeps account settings in the user menu, not the sidebar items", async () => {
    mountNavigation(portalSessionFixture({ staff: true, member: true }));
    await settle();

    expect([...container.querySelectorAll(".portal-sidebar-link")].map((link) => link.textContent)).not.toContain(
      "Account Settings",
    );
    // Located by what it is — the menu button named "Account menu" — rather
    // than by the class its content happens to carry, so restyling the trigger
    // does not break a test about where account settings live.
    const userButton = container.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!;
    expect(userButton.getAttribute("aria-label")).toBe("Account menu");
    expect(userButton.textContent).toContain("Portal Tester");
    expect(userButton.textContent).toContain("PT");

    void act(() => userButton.click());
    await settle();
    const items = [...container.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent);
    expect(items).toEqual(["My profile", "My participation", "Account settings", "Sign out"]);
  });

  it("nests subgroups beneath their listed parent and names an absent parent as context", async () => {
    const parent = group("10000000-0000-4000-8000-000000000001", "Post-Quantum Cryptography");
    const child = {
      ...group("10000000-0000-4000-8000-000000000002", "Hybrid Certificates"),
      parentGroup: {
        id: parent.id as string,
        slug: parent.slug as string,
        name: parent.name as string,
        type: parent.type,
      },
    };
    const orphan = {
      ...group("10000000-0000-4000-8000-000000000003", "Task Force X"),
      parentGroup: {
        id: "10000000-0000-4000-8000-000000000099",
        slug: "unlisted-parent",
        name: "Unlisted Parent",
        type: parent.type,
      },
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
        location.origin,
      );
      if (url.pathname === "/api/v1/groups") {
        return json({ groups: [parent, child, orphan], page: { limit: 12, offset: 0, total: 3, hasMore: false } });
      }
      throw new Error(`Unexpected request: ${url.pathname}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    mountNavigation(portalSessionFixture({ staff: true }));
    await settle();
    await settle();

    const groupsList = container.querySelector(".portal-sidebar-groups")!;
    const nested = groupsList.querySelector(".portal-sidebar-subgroups")!;
    expect(nested).toBeTruthy();
    // The child renders inside its parent's list item, not as a sibling.
    expect(nested.closest("li")?.querySelector("a")?.textContent).toBe("Post-Quantum Cryptography");
    expect(nested.querySelector("a")?.textContent).toBe("Hybrid Certificates");
    // The orphaned child stays top-level and names its unlisted parent.
    const orphanLink = [...groupsList.querySelectorAll("a")].find((a) => a.textContent?.includes("Task Force X"))!;
    expect(orphanLink.querySelector(".portal-sidebar-group-context")?.textContent).toBe("Unlisted Parent");
    expect(orphanLink.closest(".portal-sidebar-subgroups")).toBeNull();
  });

  it("lists represented organizations in the account menu with workspace deep links", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
        location.origin,
      );
      if (url.pathname === "/api/v1/users/current/groups") return json(emptyPage("groups"));
      if (url.pathname === "/api/v1/groups") return json(emptyPage("groups"));
      if (url.pathname === "/api/v1/users/current/organizations") {
        return json({
          organizations: [
            {
              organizationId: "50000000-0000-4000-8000-000000000001",
              memberId: "30000000-0000-4000-8000-000000000001",
              name: "Example Trust Services",
              membershipCategory: "A",
              isOrgContact: true,
              isPrimaryContact: false,
              hasPendingReview: false,
            },
          ],
          page: { limit: 12, offset: 0, total: 1, hasMore: false },
        });
      }
      throw new Error(`Unexpected request: ${url.pathname}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    mountNavigation(portalSessionFixture({ staff: true, member: true }));
    await settle();
    await settle();

    const userButton = container.querySelector<HTMLButtonElement>(".portal-sidebar-user")!;
    void act(() => userButton.click());
    await settle();
    const items = [...container.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent);
    expect(items).toEqual(["My profile", "Example Trust Services", "My participation", "Account settings", "Sign out"]);
  });

  it("shows the headshot in the user button when one is available", async () => {
    mountNavigation(portalSessionFixture({ staff: true, member: true }), "/images/headshots/tester.jpg");
    await settle();

    const avatar = container.querySelector(".portal-user-avatar img");
    expect(avatar?.getAttribute("src")).toBe("/images/headshots/tester.jpg");
    expect(avatar?.getAttribute("alt")).toBe("");
  });
});
