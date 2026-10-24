import { portalSession } from "../../assets/ts/member-flows/portal/state";
import { portalSessionFixture } from "../helpers/portal-session";
import { visibleEventWorkspaceTabs } from "../../assets/ts/member-flows/portal/sections/management/group-event-workspace-tabs";
// @vitest-environment jsdom
import { render, type ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GroupEvent } from "../../assets/shared/schemas/group-events";
import { GroupEventWorkspace } from "../../assets/ts/member-flows/portal/sections/management/GroupEventWorkspace";
import { GroupEvents } from "../../assets/ts/member-flows/portal/sections/management/GroupEvents";
import { isCurrentTab, tabs } from "./helpers/tabs";

const navigate = vi.fn();

vi.mock("wouter/use-hash-location", () => ({
  useHashLocation: () => ["", navigate],
}));

vi.mock("wouter", () => ({
  Link: ({ children, href, ...rest }: { children?: ComponentChildren; href: string } & Record<string, unknown>) => (
    <a href={`#${href}`} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("../../assets/ts/member-flows/portal/sections/management/GroupEventSettingsSection", () => ({
  GroupEventSettingsSection: ({
    section,
    groupSettings,
  }: {
    section?: string;
    groupSettings?: { canEdit: boolean };
  }) => (
    <section aria-label={`Canonical ${section ?? "cfp"} settings`} data-can-edit={String(groupSettings?.canEdit)} />
  ),
}));

const GROUP_ID = "10000000-0000-4000-8000-000000000001";
const EVENT_ID = "architecture-workshop";
const mounted: HTMLElement[] = [];

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
}

async function mount(node: ComponentChildren): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.append(container);
  mounted.push(container);
  await act(async () => {
    render(node, container);
    await vi.dynamicImportSettled();
  });
  await settle();
  return container;
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function tabButtons(container: HTMLElement): HTMLElement[] {
  return tabs(container);
}

function tabLabels(container: HTMLElement): string[] {
  return tabButtons(container).map((button) => button.textContent?.trim() ?? "");
}

function tab(container: HTMLElement, label: string): HTMLElement | undefined {
  return tabButtons(container).find((button) => button.textContent?.trim() === label);
}

function baseEvent(overrides: Partial<GroupEvent> = {}): GroupEvent {
  return {
    id: EVENT_ID,
    ownerGroupId: GROUP_ID,
    seriesId: null,
    slug: EVENT_ID,
    basePath: `/events/2026/${EVENT_ID}/`,
    name: "Architecture workshop",
    timezone: "Europe/Amsterdam",
    startsAt: "2026-09-01T15:00:00.000Z",
    endsAt: "2026-09-01T16:00:00.000Z",
    profileKey: "workshop",
    sourceMode: "portal",
    registrationPolicy: "optional",
    visibility: "group_members",
    inviteLimitAttendee: 5,
    city: null,
    country: null,
    meetingLocation: null,
    links: [],
    nextOccurrenceAt: "2026-09-01T15:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    proposalAccess: null,
    capabilities: ["view"],
    ...overrides,
  };
}

beforeEach(async () => {
  await import("../../assets/ts/member-flows/portal/sections/events/detail/settings/EventTeamSettings");
  navigate.mockReset();
});

afterEach(() => {
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
  vi.unstubAllGlobals();
});

describe("group event workspace", () => {
  it("keeps Live settings reachable only for the event's explicit live moderator scope", async () => {
    const previous = portalSession.value;
    try {
      portalSession.value = portalSessionFixture({
        staff: true,
        grants: [{ permission: "agenda:live_moderate", contextType: "event", contextId: EVENT_ID }],
      });
      expect(visibleEventWorkspaceTabs(baseEvent()).map((tab) => tab.key)).toContain("settings");
      expect(visibleEventWorkspaceTabs(baseEvent({ id: "other-event" })).map((tab) => tab.key)).not.toContain(
        "settings",
      );
    } finally {
      portalSession.value = previous;
    }
  });

  it("shows a location-less event on its own clock with the zone named, not the organizer's", async () => {
    const event = baseEvent({ city: null, country: null, capabilities: ["view", "manage"] });
    const container = await mount(<GroupEventWorkspace event={event} groupId={GROUP_ID} />);

    // 15:00 UTC is 17:00 in Amsterdam in September; the zone travels with the
    // time, on the agenda's 24-hour clock and named by its city.
    const lede = container.querySelector(".pk-profile-header__lede")?.textContent ?? "";
    expect(lede).toContain("17:00 Amsterdam time");
    expect(lede).not.toMatch(/PM|GMT|CEST/);
    const starts = [...container.querySelectorAll("dl dt")].find((term) => term.textContent === "Starts");
    expect(starts?.nextElementSibling?.textContent).toContain("17:00 Amsterdam time");
  });

  it("names an event's clock by the event's city, not by its zone's", async () => {
    const event = baseEvent({
      timezone: "America/Chicago",
      city: "Austin",
      country: "US",
      meetingLocation: null,
      startsAt: "2025-01-15T15:00:00.000Z",
      endsAt: "2025-01-16T23:00:00.000Z",
      nextOccurrenceAt: null,
      capabilities: ["view", "manage"],
    });
    const container = await mount(<GroupEventWorkspace event={event} groupId={GROUP_ID} />);

    // Austin runs on the Chicago zone: 15:00 UTC is 09:00 there in January.
    const lede = container.querySelector(".pk-profile-header__lede")?.textContent ?? "";
    // The place beside the time says whose clock it is, so the city is said once.
    expect(lede).toContain("09:00 · Austin, United States");
    expect(lede).not.toContain("Austin time");
    expect(lede).not.toContain("Chicago");
    const starts = [...container.querySelectorAll("dl dt")].find((term) => term.textContent === "Starts");
    expect(starts?.nextElementSibling?.textContent).toContain("09:00 Austin time");
  });

  it("defaults to the overview tab, never settings, even for a manager", async () => {
    const event = baseEvent({ capabilities: ["view", "manage_attendance", "manage"] });
    const container = await mount(<GroupEventWorkspace event={event} groupId={GROUP_ID} />);

    expect(isCurrentTab(tab(container, "Overview"))).toBe(true);
    expect(isCurrentTab(tab(container, "Settings"))).toBe(false);
    expect(container.textContent).not.toContain("Manage meeting series");
    // A manager who cannot register gets the facts across the width, not
    // beside an empty main column.
    expect(container.querySelector('[aria-label="Schedule"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Event facts"]')).not.toBeNull();
    expect(container.querySelector(".pk-record")).toBeNull();
  });

  it("filters tabs by capability: a manager sees settings, invitations, and communications", async () => {
    const event = baseEvent({ capabilities: ["view", "manage_attendance", "manage"] });
    const container = await mount(<GroupEventWorkspace event={event} groupId={GROUP_ID} />);

    expect(tabLabels(container)).toEqual([
      "Overview",
      "Registrations",
      "Invitations",
      "Communications",
      "Analytics",
      "Settings",
    ]);
  });

  it("keeps management navigation under Settings and Analytics for capable events", async () => {
    const manager = baseEvent({ capabilities: ["view", "manage_attendance", "manage"] });
    const managerContainer = await mount(<GroupEventWorkspace event={manager} groupId={GROUP_ID} />);
    expect(tabLabels(managerContainer)).toEqual(expect.arrayContaining(["Settings", "Analytics"]));
    expect(tabLabels(managerContainer)).not.toContain("Team");
    expect(tabLabels(managerContainer)).not.toContain("Promoters");

    const viewer = baseEvent({ capabilities: ["view"] });
    const viewerContainer = await mount(<GroupEventWorkspace event={viewer} groupId={GROUP_ID} />);
    expect(tabLabels(viewerContainer)).not.toEqual(expect.arrayContaining(["Team"]));
    expect(tabLabels(viewerContainer)).not.toEqual(expect.arrayContaining(["Promoters"]));
    expect(tabLabels(viewerContainer)).not.toEqual(expect.arrayContaining(["Analytics"]));
  });

  it("filters tabs by capability: a participant with only register sees overview only", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json({
          event: { id: EVENT_ID, slug: EVENT_ID, name: "Architecture workshop" },
          purpose: "event_registration",
          form: null,
          registrationPolicy: "public",
          requiredTerms: [],
          allowedSessionTypes: [],
          eventDays: [],
        }),
      ),
    );
    const event = baseEvent({ capabilities: ["view", "register"] });
    const container = await mount(<GroupEventWorkspace event={event} groupId={GROUP_ID} />);
    await settle();

    expect(tabLabels(container)).toEqual(["Overview"]);
    expect(container.textContent).toContain("Register for this event");
  });

  it("adds the proposals tab only when proposalAccess.canRead is granted", async () => {
    const withoutAccess = baseEvent({ capabilities: ["view"] });
    const readOnly = await mount(<GroupEventWorkspace event={withoutAccess} groupId={GROUP_ID} />);
    expect(tabLabels(readOnly)).toEqual(["Overview"]);

    const withAccess = baseEvent({
      capabilities: ["view"],
      proposalAccess: {
        eventPermissions: ["proposals:read"],
        canRead: true,
        canReview: false,
        canFinalize: false,
        canEditAcceptedAbstract: false,
        canCancelAcceptedProposal: false,
      },
    });
    const container = await mount(<GroupEventWorkspace event={withAccess} groupId={GROUP_ID} />);
    expect(tabLabels(container)).toEqual(["Overview", "Proposals"]);
  });

  it("renders the absorbed Team tab against the event's own slug-driven endpoint", async () => {
    const event = baseEvent({ capabilities: ["view", "manage_attendance", "manage"], slug: "architecture-workshop" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        if (url.pathname === "/api/v1/events/architecture-workshop/team")
          return json({ people: [], page: { limit: 50, offset: 0, total: 0, hasMore: false } });
        throw new Error(`Unexpected request: ${url.pathname}`);
      }),
    );

    const container = await mount(
      <GroupEventWorkspace event={event} groupId={GROUP_ID} tab="settings" detailId="team" />,
    );
    await settle();
    await settle();

    expect(isCurrentTab(tab(container, "Team"))).toBe(true);
    expect(container.textContent).toContain("Search event team");
    expect(container.textContent).not.toContain("crew@example.test");
  });

  it("navigates to the canonical URL when a tab is clicked, and back to the overview URL for the overview tab", async () => {
    const event = baseEvent({ capabilities: ["view", "register", "manage_attendance", "manage"] });
    const page = { limit: 50, offset: 0, total: 0, hasMore: false };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        if (url.pathname.endsWith("/grants")) return json({ grants: [], page });
        if (url.pathname.endsWith("/registrations")) return json({ registrations: [], page });
        if (url.pathname.endsWith("/registration-config")) {
          return json({
            event: { id: event.id, slug: event.slug, name: event.name },
            purpose: "event_registration",
            form: null,
            registrationPolicy: "public",
            requiredTerms: [],
            allowedSessionTypes: [],
            eventDays: [],
          });
        }
        throw new Error(`Unexpected request: ${url.pathname}`);
      }),
    );
    const container = await mount(<GroupEventWorkspace event={event} groupId={GROUP_ID} tab="settings" />);
    await settle();

    expect(tab(container, "Registrations")?.getAttribute("href")).toBe(
      `#/groups/${GROUP_ID}/events/${EVENT_ID}/registrations`,
    );

    await act(async () => {
      tab(container, "Registrations")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await settle();
    expect(navigate).toHaveBeenCalledWith(`/groups/${GROUP_ID}/events/${EVENT_ID}/registrations`);

    await act(async () => {
      tab(container, "Overview")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await settle();
    expect(navigate).toHaveBeenCalledWith(`/groups/${GROUP_ID}/events/${EVENT_ID}`);
  });

  it("exposes routed response views for registration and proposal forms", async () => {
    const event = baseEvent({
      capabilities: ["view", "manage_attendance"],
      proposalAccess: {
        eventPermissions: ["proposals:read"],
        canRead: true,
        canReview: false,
        canFinalize: false,
        canEditAcceptedAbstract: false,
        canCancelAcceptedProposal: false,
      },
    });

    const registrations = await mount(<GroupEventWorkspace event={event} groupId={GROUP_ID} tab="registrations" />);
    await vi.waitFor(async () => {
      await settle();
      expect(registrations.querySelector('nav[aria-label="Registration sections"]')).not.toBeNull();
    });
    const registrationSections = registrations.querySelector('nav[aria-label="Registration sections"]');
    expect(registrationSections?.textContent).toContain("Summary");
    expect(registrationSections?.textContent).toContain("Responses");
    expect(registrationSections?.querySelector('a[href$="/registrations/responses"]')).not.toBeNull();

    const proposals = await mount(<GroupEventWorkspace event={event} groupId={GROUP_ID} tab="proposals" />);
    await vi.waitFor(async () => {
      await settle();
      expect(proposals.querySelector('nav[aria-label="Proposal sections"]')).not.toBeNull();
    });
    const proposalSections = proposals.querySelector('nav[aria-label="Proposal sections"]');
    expect(proposalSections?.textContent).toContain("Summary");
    expect(proposalSections?.textContent).toContain("Speakers");
    expect(proposalSections?.querySelector('a[href$="/proposals/speakers"]')).not.toBeNull();
    expect(proposalSections?.textContent).toContain("Responses");
    expect(proposalSections?.querySelector('a[href$="/proposals/responses"]')).not.toBeNull();
    expect(proposalSections?.querySelector('a[href$="/proposals/call"]')).toBeNull();
    await mount(<GroupEventWorkspace event={event} groupId={GROUP_ID} tab="proposals" detailId="call" />);
    expect(navigate).toHaveBeenCalledWith(`/groups/${GROUP_ID}/events/${EVENT_ID}/settings/cfp`);
  });

  it("separates General settings from other topics and starts read-only", async () => {
    const event = baseEvent({ capabilities: ["view", "manage"] });
    const container = await mount(<GroupEventWorkspace event={event} groupId={GROUP_ID} tab="settings" />);
    expect(
      container.querySelector('section[aria-label="Canonical general settings"]')?.getAttribute("data-can-edit"),
    ).toBe("true");
    expect(container.querySelector('nav[aria-label="General settings"]')).toBeNull();
    expect(container.querySelector("form")).toBeNull();
    expect(container.querySelector('a[href$="/settings/location"]')).not.toBeNull();
    expect(container.querySelector('a[href$="/settings/cfp"]')).not.toBeNull();
    expect(container.querySelector('a[href$="/settings/session-types"]')).not.toBeNull();
    expect(container.querySelector('section[aria-label="Sponsor tiers"]')).toBeNull();
  });

  it("loads Location directly without exposing General fields", async () => {
    const event = baseEvent({ capabilities: ["view", "manage"] });
    const container = await mount(
      <GroupEventWorkspace event={event} groupId={GROUP_ID} tab="settings" detailId="location" />,
    );
    expect(
      container.querySelector('section[aria-label="Canonical location settings"]')?.getAttribute("data-can-edit"),
    ).toBe("true");
    expect(container.querySelector('section[aria-label="Canonical general settings"]')).toBeNull();
    expect(isCurrentTab(tab(container, "Location")!)).toBe(true);
    expect(container.querySelector("form")).toBeNull();
  });

  it("redirects the obsolete staffing route into the unified Team", async () => {
    const event = baseEvent({ capabilities: ["view", "manage"] });
    await mount(
      <GroupEventWorkspace event={event} groupId={GROUP_ID} tab="settings" detailId="team" detailTab="staffing" />,
    );
    expect(navigate).toHaveBeenCalledWith(`/groups/${GROUP_ID}/events/${EVENT_ID}/settings/team`);
  });

  it("preserves the Attendance deep link under the Analytics permission gate", async () => {
    const event = baseEvent({ capabilities: ["view"] });
    const container = await mount(
      <GroupEventWorkspace event={event} groupId={GROUP_ID} tab="attendance" detailId="imports" />,
    );
    expect(container.textContent).toContain("This event section is not available to your current identity.");
    expect(tabLabels(container)).not.toContain("Attendance");
  });

  it("shows the not-available pattern for a capability-less tab request instead of falling back", async () => {
    const event = baseEvent({ capabilities: ["view"] });
    const container = await mount(<GroupEventWorkspace event={event} groupId={GROUP_ID} tab="settings" />);

    expect(container.textContent).toContain("This event section is not available to your current identity.");
    expect(container.textContent).not.toContain("Manage meeting series");
    // The refusal interrupts rather than sitting silently in the layout: it is
    // an alert, so a reader who asked for the tab is told it was refused.
    const alert = container.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert?.textContent).toContain("not available to your current identity");
  });

  it("names the workspace, the open section, and the overview metadata for assistive technology", async () => {
    const event = baseEvent({
      capabilities: ["view", "manage_attendance", "manage"],
      links: ["https://example.test/agenda"],
    });
    const container = await mount(<GroupEventWorkspace event={event} groupId={GROUP_ID} />);

    // Both nested regions are named, so a reader moving by landmark is not
    // told only "region, region".
    const regions = Array.from(container.querySelectorAll("section[aria-label]")).map((section) =>
      section.getAttribute("aria-label"),
    );
    expect(regions).toContain("Architecture workshop workspace");
    expect(regions).toContain("Overview — Architecture workshop");

    // The overview is a record: the schedule takes the width and the event's
    // facts keep the column beside it, each a term/value list so every value
    // is announced with the term it belongs to rather than as loose text.
    expect(Array.from(container.querySelectorAll("dl dt")).map((term) => term.textContent)).toEqual([
      "Starts",
      "Ends",
      "Time zone",
      "Location",
      "Profile",
      "Registration",
      "Visibility",
    ]);

    // A link that leaves the page says so in words, not by an icon alone —
    // now through the shared marked list rather than a second hand-rolled one.
    const list = container.querySelector('ul[aria-label="Event links"]');
    expect(list).not.toBeNull();
    const link = list?.querySelector("a");
    expect(link?.getAttribute("href")).toBe("https://example.test/agenda");
    expect(link?.textContent).toContain("(opens in a new tab)");
    expect(link?.querySelector(".pk-sr-only")).not.toBeNull();
    expect(link?.querySelector(".pk-link-list__label")?.textContent).toBe("example.test");
  });

  it("offers the meeting series as a real link rather than a handler no keyboard can reach", async () => {
    const event = baseEvent({
      capabilities: ["view", "manage_attendance", "manage"],
      seriesId: "20000000-0000-4000-8000-000000000001",
      profileKey: "meeting",
    });
    const container = await mount(<GroupEventWorkspace event={event} groupId={GROUP_ID} tab="settings" />);

    const series = Array.from(container.querySelectorAll("a")).find(
      (anchor) => anchor.textContent === "Manage meeting series",
    );
    expect(series?.getAttribute("href")).toBe(`#/groups/${GROUP_ID}/meetings`);
    // A meeting inside a series is not standalone, so it offers no inline
    // editor beside the series link.
    expect(container.textContent).not.toContain("Edit event");
  });

  it("falls back to the default tab for an unrecognized tab key", async () => {
    const event = baseEvent({ capabilities: ["view", "manage"] });
    const container = await mount(<GroupEventWorkspace event={event} groupId={GROUP_ID} tab="not-a-real-tab" />);

    expect(container.textContent).not.toContain("not available to your current identity");
    expect(isCurrentTab(tab(container, "Overview"))).toBe(true);
  });

  it("threads the group event's tab through GroupEvents so a proposals deep link opens the proposals tab", async () => {
    const event = baseEvent({
      capabilities: ["view"],
      proposalAccess: {
        eventPermissions: ["proposals:read"],
        canRead: true,
        canReview: false,
        canFinalize: false,
        canEditAcceptedAbstract: false,
        canCancelAcceptedProposal: false,
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        if (url.pathname.endsWith(`/events/${EVENT_ID}`)) return json({ event });
        if (url.pathname === "/api/v1/proposals/programs") {
          return json({ programs: [], page: { limit: 50, offset: 0, total: 0, hasMore: false } });
        }
        if (url.pathname === `/api/v1/events/${event.slug}/proposals`) {
          return json({
            proposals: [],
            page: { limit: 50, offset: 0, total: 0, hasMore: false },
            event: { id: event.id, slug: event.slug, name: event.name },
            access: {
              eventPermissions: [],
              canRead: true,
              canReview: false,
              canFinalize: false,
              canEditAcceptedAbstract: false,
              canCancelAcceptedProposal: false,
            },
            stats: { byStatus: {}, byRecommendation: {}, reviewedCount: 0, unreviewedCount: 0, total: 0 },
          });
        }
        throw new Error(`Unexpected request: ${url.pathname}`);
      }),
    );

    const container = await mount(
      <GroupEvents groupId={GROUP_ID} initialEventId={EVENT_ID} initialEventTab="proposals" />,
    );
    await settle();
    await settle();

    expect(isCurrentTab(tab(container, "Proposals"))).toBe(true);
    await vi.waitFor(async () => {
      await settle();
      expect(container.querySelector("caption")?.textContent).toBe("Event proposals");
    });
  });
});
