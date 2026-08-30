// @vitest-environment jsdom
import { render, type ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EventDetail } from "../../assets/ts/member-flows/portal/sections/events/types";
import { GeneralTab } from "../../assets/ts/member-flows/portal/sections/events/detail/settings/GeneralTab";
import { Settings } from "../../assets/ts/member-flows/portal/sections/events/detail/Settings";
import { eventTeamRolesResponseSchema } from "../../assets/shared/schemas/event-team";
import { eventDetailTabsForCapabilities } from "../../assets/ts/member-flows/portal/sections/events/detail/EventDetail";

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

const portalEvent = {
  id: "10000000-0000-4000-8000-000000000001",
  slug: "portal-workshop",
  name: "Portal workshop",
  timezone: "Europe/Amsterdam",
  startsAt: "2026-09-01T15:00:00.000Z",
  endsAt: "2026-09-01T16:00:00.000Z",
  profileKey: "workshop",
  registrationPolicy: "public",
  visibility: "public",
  inviteLimitAttendee: 5,
  updatedAt: "2026-08-29T00:00:00.000Z",
  basePath: null,
  userRetentionDays: null,
  venue: null,
  virtualUrl: null,
  heroImageUrl: null,
  location: null,
  sessionTypes: null,
  ownerGroupId: "20000000-0000-4000-8000-000000000001",
  sourceMode: "portal",
  seriesId: null,
  links: [],
  capabilities: ["read"],
  settings: { forms: { event_registration: "legacy-attendee-form" } },
} as EventDetail;

afterEach(() => {
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
  vi.unstubAllGlobals();
});

describe("admin event general settings", () => {
  it("does not render or submit portal-owned attendee registration controls", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
        expect(url.pathname).toContain("/forms");
        return json({ forms: [], page: { limit: 100, offset: 0, total: 0, hasMore: false } });
      }),
    );

    const onUpdated = vi.fn();
    const container = mount(<GeneralTab event={portalEvent} onUpdated={onUpdated} />);
    await settle();
    expect(container.textContent).not.toContain("Registration form");
    expect(container.textContent).not.toContain("Registration Mode");
    expect(container.textContent).toContain("Proposal form");
  });

  it("shows team management only with the exact event-management capability", async () => {
    const requests: URL[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        requests.push(url);
        if (url.pathname.endsWith("/roles")) {
          return json(
            eventTeamRolesResponseSchema.parse({
              roles: [],
              page: { limit: 100, offset: 0, total: 0, hasMore: false },
            }),
          );
        }
        return json({ forms: [], page: { limit: 100, offset: 0, total: 0, hasMore: false } });
      }),
    );

    const reader = mount(<Settings event={portalEvent} onUpdated={vi.fn()} subTab="team" />);
    await settle();
    expect(reader.textContent).not.toContain("Add team member");
    expect(requests.some(({ pathname }) => pathname.endsWith("/roles"))).toBe(false);

    const manager = mount(
      <Settings event={{ ...portalEvent, capabilities: ["read", "manage"] }} onUpdated={vi.fn()} subTab="team" />,
    );
    await settle();
    await settle();
    expect(manager.textContent).toContain("Add team member");
    expect(requests.some(({ pathname }) => pathname === "/api/v1/events/portal-workshop/roles")).toBe(true);
  });

  it("keeps sponsor-tier actions hidden from an event reader", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ tiers: [{ tierName: "Community", hasAttendeeDataAccess: false }] })),
    );

    const container = mount(<Settings event={portalEvent} onUpdated={vi.fn()} subTab="sponsor-tiers" />);
    await settle();
    await settle();

    const tierName = [...container.querySelectorAll<HTMLInputElement>("input")].find(
      (input) => input.value === "Community",
    );
    expect(tierName?.disabled).toBe(true);
    expect(container.textContent).not.toContain("+ Add tier");
    expect(container.textContent).not.toContain("Remove");
    expect([...container.querySelectorAll("button")].some((button) => button.textContent === "Save")).toBe(false);
  });

  it("does not expose event read projections without event read capability", () => {
    const withoutRead = eventDetailTabsForCapabilities([]).map(({ key }) => key);
    expect(withoutRead).not.toContain("registrations");
    expect(withoutRead).not.toContain("promoters");
    expect(withoutRead).not.toContain("stats");

    const withRead = eventDetailTabsForCapabilities(["read"]).map(({ key }) => key);
    expect(withRead).not.toContain("registrations");
    expect(withRead).toContain("promoters");
    expect(withRead).toContain("stats");

    const withManage = eventDetailTabsForCapabilities(["manage"]).map(({ key }) => key);
    expect(withManage).toContain("registrations");
  });

  it("replaces the General tab with a series-managed notice for a meeting-series event", async () => {
    const seriesEvent = {
      ...portalEvent,
      seriesId: "60000000-0000-4000-8000-000000000001",
      ownerGroupId: "20000000-0000-4000-8000-000000000001",
    };
    const container = mount(<Settings event={seriesEvent} onUpdated={vi.fn()} />);
    await settle();

    expect(container.textContent).not.toContain("Event Name");
    expect(container.textContent).toContain("managed by a meeting series");
    const link = container.querySelector<HTMLAnchorElement>("a");
    expect(link?.getAttribute("href")).toBe(
      "#/groups/20000000-0000-4000-8000-000000000001/meetings/60000000-0000-4000-8000-000000000001",
    );
  });

  it("explains an undetermined owning group instead of linking nowhere", async () => {
    const seriesEvent = {
      ...portalEvent,
      seriesId: "60000000-0000-4000-8000-000000000001",
      ownerGroupId: null,
    };
    const container = mount(<Settings event={seriesEvent} onUpdated={vi.fn()} />);
    await settle();

    expect(container.textContent).toContain("could not be determined");
    expect(container.querySelector("a")).toBeNull();
  });

  it("keeps sponsor tiers and team working for a meeting-series event", async () => {
    const seriesEvent = {
      ...portalEvent,
      seriesId: "60000000-0000-4000-8000-000000000001",
      ownerGroupId: "20000000-0000-4000-8000-000000000001",
      capabilities: ["read", "manage"] as EventDetail["capabilities"],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ tiers: [] })),
    );
    const tiers = mount(<Settings event={seriesEvent} onUpdated={vi.fn()} subTab="sponsor-tiers" />);
    await settle();
    await settle();
    expect(tiers.textContent).toContain("attendee-data access in the portal");

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ roles: [], page: { limit: 100, offset: 0, total: 0, hasMore: false } })),
    );
    const team = mount(<Settings event={seriesEvent} onUpdated={vi.fn()} subTab="team" />);
    await settle();
    await settle();
    expect(team.textContent).toContain("Add team member");
  });
});
