// @vitest-environment jsdom
import { render, type ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GroupEvent } from "../../assets/shared/schemas/group-events";
import { GroupEventWorkspace } from "../../assets/ts/member-flows/portal/sections/management/GroupEventWorkspace";
import { GroupEvents } from "../../assets/ts/member-flows/portal/sections/management/GroupEvents";

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

const GROUP_ID = "10000000-0000-4000-8000-000000000001";
const EVENT_ID = "architecture-workshop";
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

function tabButtons(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>('[role="tab"]'));
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
    location: "Online",
    links: [],
    nextOccurrenceAt: "2026-09-01T15:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    proposalAccess: null,
    capabilities: ["view"],
    ...overrides,
  };
}

beforeEach(() => {
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
  it("defaults to the overview tab, never settings, even for a manager", () => {
    const event = baseEvent({ capabilities: ["view", "manage_attendance", "manage"] });
    const container = mount(<GroupEventWorkspace event={event} groupId={GROUP_ID} />);

    expect(tab(container, "Overview")?.getAttribute("aria-selected")).toBe("true");
    expect(tab(container, "Settings")?.getAttribute("aria-selected")).not.toBe("true");
    expect(container.textContent).not.toContain("Manage meeting series");
    expect(container.querySelector("dl")).not.toBeNull();
  });

  it("filters tabs by capability: a manager sees settings, invitations, and communications", () => {
    const event = baseEvent({ capabilities: ["view", "manage_attendance", "manage"] });
    const container = mount(<GroupEventWorkspace event={event} groupId={GROUP_ID} />);

    expect(tabLabels(container)).toEqual([
      "Overview",
      "Registrations",
      "Invitations",
      "Communications",
      "Team",
      "Promoters",
      "Analytics",
      "Settings",
    ]);
  });

  it("shows Team, Promoters, and Analytics for a manage-capable event, but not for a view-only one", () => {
    const manager = baseEvent({ capabilities: ["view", "manage_attendance", "manage"] });
    const managerContainer = mount(<GroupEventWorkspace event={manager} groupId={GROUP_ID} />);
    expect(tabLabels(managerContainer)).toEqual(expect.arrayContaining(["Team", "Promoters", "Analytics"]));

    const viewer = baseEvent({ capabilities: ["view"] });
    const viewerContainer = mount(<GroupEventWorkspace event={viewer} groupId={GROUP_ID} />);
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
          requiredTerms: [],
          allowedSessionTypes: [],
          eventDays: [],
        }),
      ),
    );
    const event = baseEvent({ capabilities: ["view", "register"] });
    const container = mount(<GroupEventWorkspace event={event} groupId={GROUP_ID} />);
    await settle();

    expect(tabLabels(container)).toEqual(["Overview"]);
    expect(container.textContent).toContain("Register for this event");
  });

  it("adds the proposals tab only when proposalAccess.canRead is granted", () => {
    const withoutAccess = baseEvent({ capabilities: ["view"] });
    const readOnly = mount(<GroupEventWorkspace event={withoutAccess} groupId={GROUP_ID} />);
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
    const container = mount(<GroupEventWorkspace event={withAccess} groupId={GROUP_ID} />);
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
        if (url.pathname === "/api/v1/events/architecture-workshop/roles") {
          return json({
            roles: [
              {
                id: "10000000-0000-4000-8000-000000000009",
                userEmail: "crew@example.test",
                userId: "10000000-0000-4000-8000-000000000010",
                role: "volunteer",
                grantedByUserId: null,
                expiresAt: null,
                createdAt: "2026-08-29T10:00:00.000Z",
                granterEmail: null,
              },
            ],
            page: { limit: 100, offset: 0, total: 1, hasMore: false },
          });
        }
        throw new Error(`Unexpected request: ${url.pathname}`);
      }),
    );

    const container = mount(<GroupEventWorkspace event={event} groupId={GROUP_ID} tab="team" />);
    await settle();
    await settle();

    expect(tab(container, "Team")?.getAttribute("aria-selected")).toBe("true");
    expect(container.textContent).toContain("crew@example.test");
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
            requiredTerms: [],
            allowedSessionTypes: [],
            eventDays: [],
          });
        }
        throw new Error(`Unexpected request: ${url.pathname}`);
      }),
    );
    const container = mount(<GroupEventWorkspace event={event} groupId={GROUP_ID} tab="settings" />);
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

  it("shows the not-available pattern for a capability-less tab request instead of falling back", () => {
    const event = baseEvent({ capabilities: ["view"] });
    const container = mount(<GroupEventWorkspace event={event} groupId={GROUP_ID} tab="settings" />);

    expect(container.textContent).toContain("This event section is not available to your current identity.");
    expect(container.textContent).not.toContain("Manage meeting series");
  });

  it("falls back to the default tab for an unrecognized tab key", () => {
    const event = baseEvent({ capabilities: ["view", "manage"] });
    const container = mount(<GroupEventWorkspace event={event} groupId={GROUP_ID} tab="not-a-real-tab" />);

    expect(container.textContent).not.toContain("not available to your current identity");
    expect(tab(container, "Overview")?.getAttribute("aria-selected")).toBe("true");
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

    const container = mount(<GroupEvents groupId={GROUP_ID} initialEventId={EVENT_ID} initialEventTab="proposals" />);
    await settle();
    await settle();

    expect(tab(container, "Proposals")?.getAttribute("aria-selected")).toBe("true");
    expect(container.textContent).toContain("Proposal program");
  });
});
