// @vitest-environment jsdom
/**
 * Canonical event homes are groups: standalone /events/:slug management
 * views redirect to the owning group's event workspace. Events without an
 * owning group never gain a second, system-level management surface.
 */
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventWorkspace } from "../../assets/ts/member-flows/portal/sections/events/EventWorkspace";

const navigate = vi.fn();

vi.mock("wouter", () => ({
  Link: ({ children, href }: { children?: preact.ComponentChildren; href: string }) => (
    <a href={`#${href}`}>{children}</a>
  ),
}));
vi.mock("wouter/use-hash-location", () => ({
  useHashLocation: () => ["/events/summit/registrations", navigate],
}));

const GROUP_ID = "20000000-0000-4000-8000-000000000007";
const EVENT_ID = "e0000000-0000-4000-8000-000000000001";

function detailResponse(ownerGroupId: string | null) {
  return {
    event: {
      id: EVENT_ID,
      slug: "summit",
      name: "Summit",
      timezone: "UTC",
      startsAt: null,
      endsAt: null,
      profileKey: null,
      sourceMode: null,
      registrationPolicy: "no_registration",
      visibility: "public",
      inviteLimitAttendee: 0,
      updatedAt: "2026-08-01T00:00:00.000Z",
      ownerGroupId,
      seriesId: null,
      basePath: null,
      userRetentionDays: null,
      venue: null,
      virtualUrl: null,
      heroImageUrl: null,
      location: null,
      sessionTypes: null,
      links: [],
      settings: {},
      capabilities: ["read", "write", "manage"],
    },
  };
}

async function settle(): Promise<void> {
  for (let round = 0; round < 3; round += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
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

function stubDetail(ownerGroupId: string | null): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), location.origin);
      if (url.pathname === "/api/v1/events/summit") {
        return new Response(JSON.stringify(detailResponse(ownerGroupId)), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: { code: "NOT_FOUND", message: "nope" } }), { status: 404 });
    }),
  );
}

describe("standalone event views redirect to the owning group", () => {
  it("redirects a group-owned event's tab view into the group workspace", async () => {
    stubDetail(GROUP_ID);
    await act(() => render(<EventWorkspace view="detail" slug="summit" tab="registrations" />, container));
    await settle();
    expect(navigate).toHaveBeenCalledWith(`/groups/${GROUP_ID}/events/${EVENT_ID}/registrations`, { replace: true });
  });

  it.each([
    {
      label: "attendance analytics",
      props: { tab: "stats", subTab: "attendance" },
      destination: `/groups/${GROUP_ID}/events/${EVENT_ID}/stats/attendance`,
    },
    {
      label: "proposal responses",
      props: { tab: "proposals", subTab: "responses" },
      destination: `/groups/${GROUP_ID}/events/${EVENT_ID}/proposals/responses`,
    },
    {
      label: "registration responses",
      props: { tab: "registrations", subTab: "responses" },
      destination: `/groups/${GROUP_ID}/events/${EVENT_ID}/registrations/responses`,
    },
    {
      label: "event settings",
      props: { tab: "settings", subTab: "sponsor-tiers" },
      destination: `/groups/${GROUP_ID}/events/${EVENT_ID}/settings`,
    },
    {
      label: "the add-team-member page",
      props: { tab: "settings", subTab: "team", detailSegment: "new" },
      destination: `/groups/${GROUP_ID}/events/${EVENT_ID}/team/new`,
    },
  ])("preserves $label when redirecting a legacy event URL", async ({ props, destination }) => {
    stubDetail(GROUP_ID);
    await act(() => render(<EventWorkspace view="detail" slug="summit" {...props} />, container));
    await settle();
    expect(navigate).toHaveBeenCalledWith(destination, { replace: true });
  });

  it("maps registration and proposal detail views onto the group route", async () => {
    stubDetail(GROUP_ID);
    await act(() => render(<EventWorkspace view="registration" slug="summit" resourceId="reg-1" />, container));
    await settle();
    expect(navigate).toHaveBeenCalledWith(`/groups/${GROUP_ID}/events/${EVENT_ID}/registrations/reg-1`, {
      replace: true,
    });

    navigate.mockReset();
    await act(() => render(null, container));
    await act(() => render(<EventWorkspace view="proposal" slug="summit" resourceId="prop-9" />, container));
    await settle();
    expect(navigate).toHaveBeenCalledWith(`/groups/${GROUP_ID}/events/${EVENT_ID}/proposals/prop-9`, {
      replace: true,
    });
  });

  it("rejects a management route for an event without an owning group", async () => {
    stubDetail(null);
    await act(() => render(<EventWorkspace view="detail" slug="summit" tab="registrations" />, container));
    await settle();
    expect(navigate).toHaveBeenCalledWith("/events", { replace: true });
    expect(container.textContent).not.toContain("Registrations");
  });
  it("shows the current viewer's registration without requesting management-only data", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              event: {
                id: EVENT_ID,
                slug: "summit",
                name: "Summit",
                timezone: "UTC",
                startsAt: null,
                endsAt: null,
                profileKey: "conference",
                registrationPolicy: "public",
                visibility: "public",
                accessLevel: "participant",
                location: "Amsterdam",
                links: [],
                basePath: "/events/summit/",
                viewer: { registrationStatus: "registered", attendanceType: "in_person", waitlisted: false, days: [] },
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
      ),
    );
    await act(() => render(<EventWorkspace view="detail" slug="summit" />, container));
    await settle();
    expect(container.textContent).toContain("Your registration");
    expect(container.textContent).toContain("Registered");
    expect(container.textContent).toContain("Amsterdam");
    expect(navigate).not.toHaveBeenCalled();
    expect(vi.mocked(fetch).mock.calls.map(([input]) => String(input))).toEqual(["/api/v1/events/summit"]);
  });

  it("keeps a participant's proposals tab in the event workspace", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(String(input), location.origin);
        if (url.pathname === "/api/v1/events/summit") {
          return new Response(
            JSON.stringify({
              event: {
                id: EVENT_ID,
                slug: "summit",
                name: "Summit",
                timezone: "UTC",
                startsAt: null,
                endsAt: null,
                profileKey: "conference",
                registrationPolicy: "public",
                visibility: "public",
                accessLevel: "participant",
                location: "Amsterdam",
                links: [],
                basePath: "/events/summit/",
                viewer: null,
                participation: {
                  registrationId: null,
                  registrationStatus: null,
                  proposals: 1,
                  speakerProposals: 0,
                  proposalStates: ["submitted"],
                  speakerStates: [],
                },
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (url.pathname === "/api/v1/users/current/proposals") {
          return new Response(
            JSON.stringify({ proposals: [], page: { limit: 25, offset: 0, total: 0, hasMore: false } }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response(JSON.stringify({ error: { code: "NOT_FOUND", message: "nope" } }), { status: 404 });
      }),
    );

    await act(() => render(<EventWorkspace view="detail" slug="summit" tab="submissions" />, container));
    await settle();

    expect(navigate).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(container.textContent).toContain("Your event proposals"));
  });
});
