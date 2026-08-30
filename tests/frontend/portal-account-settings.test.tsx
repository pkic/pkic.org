// @vitest-environment jsdom
import { render, type ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountSettings } from "../../assets/ts/member-flows/portal/sections/AccountSettings";
import { profile, portalSession } from "../../assets/ts/member-flows/portal/state";
import { portalSessionFixture } from "../helpers/portal-session";

vi.mock("../../assets/ts/components/passkey-settings", () => ({
  PasskeySettings: () => <div>Passkeys</div>,
}));

vi.mock("wouter", () => ({
  Link: ({ children, href }: { children?: ComponentChildren; href: string }) => <a href={`#${href}`}>{children}</a>,
}));

let container: HTMLDivElement;

function mount(node: ComponentChildren): void {
  void act(() => render(node, container));
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

function memberProfile(): NonNullable<typeof profile.value> {
  return {
    userId: "00000000-0000-4000-8000-000000000001",
    email: "person@example.test",
    firstName: "Portal",
    lastName: "Tester",
    preferredName: null,
    jobTitle: null,
    biography: null,
    links: [],
    membershipCategory: "A",
    organizationId: "00000000-0000-4000-8000-000000000010",
    organizationName: "Example Org",
    memberSince: "2026-08-01",
    showOnOrgProfile: false,
    headshotUrl: null,
    canEditOrganizationName: false,
    isOrgContact: false,
    organizationRepresentatives: null,
    activeMemberships: [
      {
        memberId: "00000000-0000-4000-8000-000000000002",
        organizationId: "00000000-0000-4000-8000-000000000010",
        organizationName: "Example Org",
        membershipCategory: "A",
      },
      {
        memberId: "00000000-0000-4000-8000-000000000003",
        organizationId: null,
        organizationName: null,
        membershipCategory: "H5",
      },
    ],
  };
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  profile.value = null;
});

afterEach(() => {
  void act(() => render(null, container));
  container.remove();
  portalSession.value = null;
  profile.value = null;
  vi.unstubAllGlobals();
});

describe("portal account settings capacity cutover", () => {
  it("renders for a staff-only identity without calling member-only APIs", async () => {
    const requests: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        requests.push(new URL(url, location.origin).pathname);
        throw new Error(`Unexpected member API request: ${url}`);
      }),
    );
    portalSession.value = portalSessionFixture({ staff: true });

    mount(<AccountSettings />);
    await settle();

    expect(container.textContent).toContain("person@example.test");
    expect(container.textContent).toContain("Passkeys");
    expect(container.textContent).not.toContain("Notification preferences");
    expect(requests).toEqual([]);
  });

  it.each([
    ["member-only", { member: true }],
    ["dual-capacity", { staff: true, member: true }],
  ] as const)("loads notification preferences for a %s identity", async (_label, capacities) => {
    const requests: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        requests.push(url.pathname);
        if (url.pathname === "/api/v1/users/current/notifications/preferences") {
          return jsonResponse({
            workingGroupUpdates: true,
            voteReminders: true,
            generalAnnouncements: true,
            wgChairMembershipDigest: false,
          });
        }
        throw new Error(`Unexpected request: ${url}`);
      }),
    );
    portalSession.value = portalSessionFixture(capacities);

    mount(<AccountSettings />);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    expect(container.textContent).toContain("Notification preferences");
    expect(requests).toEqual(["/api/v1/users/current/notifications/preferences"]);
  });

  it("summarizes administrator access without listing individual grants", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("Unexpected request");
      }),
    );
    portalSession.value = portalSessionFixture({ staff: true });

    mount(<AccountSettings />);
    await settle();

    expect(container.textContent).toContain("Your access");
    expect(container.textContent).toContain("Administrator — this account holds every administrative permission.");
  });

  it("lists granular staff grants with their scopes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("Unexpected request");
      }),
    );
    portalSession.value = portalSessionFixture({
      staff: true,
      staffRole: "user",
      grants: [
        { permission: "audit:read", contextType: null, contextId: null },
        { permission: "events:read", contextType: "event", contextId: "event-1" },
      ],
    });

    mount(<AccountSettings />);
    await settle();

    expect(container.textContent).toContain("audit:read");
    expect(container.textContent).toContain("global");
    expect(container.textContent).toContain("events:read");
    expect(container.textContent).toContain("event event-1");
  });

  it("lists every member capacity, including organization-less ones", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        if (url.pathname === "/api/v1/users/current/notifications/preferences") {
          return jsonResponse({
            workingGroupUpdates: true,
            voteReminders: true,
            generalAnnouncements: true,
            wgChairMembershipDigest: false,
          });
        }
        throw new Error(`Unexpected request: ${url.pathname}`);
      }),
    );
    portalSession.value = portalSessionFixture({ member: true });
    profile.value = memberProfile();

    mount(<AccountSettings />);
    await settle();

    expect(container.textContent).toContain("Member capacities");
    expect(container.textContent).toContain("Example Org");
    const organizationLink = [...container.querySelectorAll("a")].find((a) => a.textContent === "Example Org");
    expect(organizationLink?.getAttribute("href")).toBe("#/organizations/00000000-0000-4000-8000-000000000010");
    expect(container.textContent).toContain("Category A");
    expect(container.textContent).toContain("Individual membership");
    expect(container.textContent).toContain("Category H5");
  });

  it("reports a notification-preference load failure instead of hiding it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: { code: "SERVER_ERROR", message: "Preferences unavailable" } }), {
            status: 500,
            headers: { "content-type": "application/json" },
          }),
      ),
    );
    portalSession.value = portalSessionFixture({ member: true });

    mount(<AccountSettings />);
    await settle();

    expect(container.textContent).toContain("Preferences unavailable");
  });
});
