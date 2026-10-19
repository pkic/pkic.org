// @vitest-environment jsdom
import { render, type ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventList } from "../../assets/ts/member-flows/portal/sections/events/EventList";
import { rowActionControlNames, runRowAction } from "./helpers/row-actions";
import { axeViolations } from "./helpers/axe";
import { portalSession } from "../../assets/ts/member-flows/portal/state";
import { portalSessionFixture } from "../helpers/portal-session";
import { eventsListQuerySchema } from "../../assets/shared/schemas/event-management";

const { navigateMock } = vi.hoisted(() => ({ navigateMock: vi.fn() }));

vi.mock("wouter/use-hash-location", () => ({ useHashLocation: () => ["", navigateMock] }));
vi.mock("wouter", () => ({
  Link: ({ children, href }: { children?: ComponentChildren; href: string }) => <a href={`#${href}`}>{children}</a>,
}));

const mounted: HTMLElement[] = [];

function mount(node: ComponentChildren, view: "grid" | "list" = "list"): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  mounted.push(container);
  void act(() => render(node, container));
  if (view === "list") {
    const button = [...container.querySelectorAll("button")].find((button) => button.textContent === "List");
    void act(() => button?.click());
  }
  return container;
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
}

/** A management-shaped row, as returned to a caller holding live event read permission. */
function managementEventRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "10000000-0000-4000-8000-000000000001",
    slug: "pqc-2026",
    name: "PQC Conference 2026",
    timezone: "UTC",
    startsAt: "2026-12-01T09:00:00.000Z",
    endsAt: "2026-12-01T17:00:00.000Z",
    profileKey: null,
    sourceMode: null,
    registrationPolicy: "public",
    visibility: "public",
    inviteLimitAttendee: 5,
    city: null,
    country: null,
    updatedAt: "2026-08-01T00:00:00.000Z",
    ownerGroupId: null,
    ownerGroupName: null,
    sourcePath: null,
    basePath: null,
    totalRegistrations: 0,
    confirmedRegistrations: 0,
    pendingInvites: 0,
    ...overrides,
  };
}

/** An audience-shaped row, as returned to every other caller. */
function audienceEventRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "10000000-0000-4000-8000-000000000002",
    slug: "pqc-2026",
    name: "PQC Conference 2026",
    timezone: "UTC",
    startsAt: "2026-12-01T09:00:00.000Z",
    endsAt: "2026-12-01T17:00:00.000Z",
    profileKey: null,
    registrationPolicy: "public",
    visibility: "public",
    accessLevel: "public",
    sponsorLeadAccess: false,
    city: null,
    country: null,
    links: [],
    basePath: "/events/pqc-2026",
    viewer: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-17T00:00:00.000Z"));
  portalSession.value = portalSessionFixture({ member: true });
});

afterEach(() => {
  history.replaceState(null, "", location.pathname);
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
  portalSession.value = null;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  navigateMock.mockReset();
});

describe("portal event list", () => {
  it("starts with public event cards and switches views without another collection request", async () => {
    const fetch = vi.fn(async () =>
      json({
        events: [audienceEventRow({ heroImageUrl: "/events/pqc-2026/hero.jpg" })],
        page: { limit: 25, offset: 0, total: 1, hasMore: false },
      }),
    );
    vi.stubGlobal("fetch", fetch);
    const container = mount(<EventList />, "grid");
    await settle();
    await settle();
    const card = container.querySelector(".event-card")!;
    expect(card.querySelector(".event-card-header img")?.getAttribute("src")).toContain("hero.jpg");
    expect(card.querySelector(".event-card-badge")?.textContent).toBe("Upcoming");
    expect(card.querySelector(".blog-card-title a")?.getAttribute("href")).toBe("#/events/pqc-2026");
    // No standing yet: the photo carries the schedule; actions stay below it.
    expect(card.querySelector('[aria-label="Your status"]')).toBeNull();
    expect(card.querySelector(".event-card-location")?.textContent).toContain("2026");
    expect(card.querySelector(".pk-row-actions")).not.toBeNull();
    const grid = [...container.querySelectorAll("button")].find((button) => button.textContent === "Grid")!;
    const list = [...container.querySelectorAll("button")].find((button) => button.textContent === "List")!;
    expect(grid.getAttribute("aria-pressed")).toBe("true");
    const count = fetch.mock.calls.length;
    await act(async () => list.click());
    expect(list.getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelector("tbody tr a")?.getAttribute("href")).toBe("#/events/pqc-2026");
    expect(fetch.mock.calls.length).toBe(count);
  });
  it("keeps the viewer's standing and actions on the shared website card", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json({
          events: [
            audienceEventRow({
              profileKey: "conference",
              viewer: {
                registrationStatus: "registered",
                attendanceType: "in_person",
                waitlisted: false,
                days: [],
                holdsWorkAddress: true,
              },
              participation: {
                registrationId: "30000000-0000-4000-8000-000000000001",
                registrationStatus: "registered",
                proposals: 2,
                speakerProposals: 1,
                proposalStates: ["accepted"],
                speakerStates: ["confirmed"],
              },
            }),
          ],
          page: { limit: 25, offset: 0, total: 1, hasMore: false },
        }),
      ),
    );
    const container = mount(<EventList />, "grid");
    await settle();
    await settle();
    const card = container.querySelector(".event-card")!;
    expect(card.querySelector(".event-card-badge")?.textContent).toBe("Upcoming");
    const status = card.querySelector('[aria-label="Your status"]')!;
    // Expected states are words, not pills: nothing here needs the viewer.
    expect([...status.querySelectorAll(".pk-collection-status__fact")].map((fact) => fact.textContent)).toEqual([
      "You're registered (in person)",
      "2 proposals (accepted)",
      "Speaker",
    ]);
    expect(status.querySelector(".pk-badge")).toBeNull();
    expect(await axeViolations(card)).toEqual([]);
    // The registration the status summarizes opens from the card's menu.
    await runRowAction(container, "PQC Conference 2026", "Open your registration");
    expect(navigateMock).toHaveBeenCalledWith("/events/pqc-2026/registrations/30000000-0000-4000-8000-000000000001");
  });

  it("keeps the list choice a compact record: title, meta values, and actions without labels", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json({
          events: [audienceEventRow({ city: "Amsterdam", country: "NL", sponsorLeadAccess: true })],
          page: { limit: 25, offset: 0, total: 1, hasMore: false },
        }),
      ),
    );
    const container = mount(<EventList />);
    await settle();
    await settle();
    const row = container.querySelector("tbody tr")!;
    const cells = [...row.querySelectorAll("td")];
    expect(cells[0]?.classList.contains("pk-table__cell--title")).toBe(true);
    expect(cells.at(-1)?.classList.contains("pk-table__cell--actions")).toBe(true);
    // The audience row has no owning group: its dash is left out of the record.
    const group = cells.find((cell) => cell.querySelector(".pk-table__mobile-label")?.textContent === "Group");
    expect(group?.classList.contains("pk-table__cell--empty")).toBe(true);
    const place = cells.find((cell) => cell.textContent?.includes("Amsterdam"));
    expect(place?.classList.contains("pk-table__cell--meta")).toBe(true);
    expect(place?.classList.contains("pk-table__cell--empty")).toBe(false);
  });

  it("links each row's owning group by name", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json({
          events: [
            managementEventRow({
              ownerGroupId: "20000000-0000-4000-8000-000000000001",
              ownerGroupName: "Post-Quantum Cryptography",
            }),
          ],
          page: { limit: 25, offset: 0, total: 1, hasMore: false },
        }),
      ),
    );

    const container = mount(<EventList />);
    await settle();
    await settle();

    const link = [...container.querySelectorAll("a")].find((a) => a.textContent === "Post-Quantum Cryptography");
    expect(link?.getAttribute("href")).toBe("#/groups/20000000-0000-4000-8000-000000000001");
  });

  it("shows a muted em dash for an event without an owning group", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json({
          events: [managementEventRow()],
          page: { limit: 25, offset: 0, total: 1, hasMore: false },
        }),
      ),
    );

    const container = mount(<EventList />);
    await settle();
    await settle();

    const row = container.querySelector("tbody tr")!;
    expect(row.querySelector("a")?.getAttribute("href")).toBe("#/events/pqc-2026");
    expect(row.textContent).toContain("—");
  });

  it("renders a humanized date instead of a raw ISO string, with no slug or Manage button", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json({
          events: [managementEventRow()],
          page: { limit: 25, offset: 0, total: 1, hasMore: false },
        }),
      ),
    );

    const container = mount(<EventList />);
    await settle();
    await settle();

    const row = container.querySelector("tbody tr")!;
    expect(row.textContent).not.toContain("2026-12-01T09:00:00.000Z");
    expect(row.textContent).not.toContain("2026-12-01");
    expect(row.textContent).toContain("(in ");
    expect(row.textContent).not.toContain("pqc-2026");
    expect([...row.querySelectorAll("button")].some((button) => button.textContent?.includes("Manage"))).toBe(false);
  });

  it("shows the viewer's own registration state for an audience entry", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json({
          events: [
            audienceEventRow({
              viewer: {
                registrationStatus: "registered",
                attendanceType: "in_person",
                waitlisted: false,
                days: [],
                holdsWorkAddress: true,
              },
            }),
          ],
          page: { limit: 25, offset: 0, total: 1, hasMore: false },
        }),
      ),
    );

    const container = mount(<EventList />);
    await settle();
    await settle();

    const row = container.querySelector("tbody tr")!;
    expect(row.querySelector(".pk-collection-status__fact")?.textContent).toBe("You're registered (in person)");

    const viewerLink = [...row.querySelectorAll("a")].find((a) => a.getAttribute("href") === "#/events/pqc-2026");
    expect(viewerLink).toBeTruthy();
  });

  it.each(["Working Group", "Board"])("offers a short workspace action using group type %s", async (groupType) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json({
          events: [
            managementEventRow({
              id: "e0000000-0000-4000-8000-000000000009",
              ownerGroupId: "20000000-0000-4000-8000-000000000001",
              ownerGroupName: "Post-Quantum Cryptography",
              ownerGroupTypeLabel: groupType,
            }),
          ],
          page: { limit: 25, offset: 0, total: 1, hasMore: false },
        }),
      ),
    );

    const container = mount(<EventList />);
    await settle();
    await settle();

    expect(rowActionControlNames(container)).toEqual(["Actions for PQC Conference 2026"]);
    await runRowAction(container, "PQC Conference 2026", `Open in ${groupType}`);

    expect(navigateMock).toHaveBeenCalledWith(
      "/groups/20000000-0000-4000-8000-000000000001/events/e0000000-0000-4000-8000-000000000009",
    );
  });

  it("opens a group-owned management row's event page and keeps the workspace a row action", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json({
          events: [
            managementEventRow({
              id: "e0000000-0000-4000-8000-000000000009",
              ownerGroupId: "20000000-0000-4000-8000-000000000001",
              ownerGroupName: "Post-Quantum Cryptography",
            }),
          ],
          page: { limit: 25, offset: 0, total: 1, hasMore: false },
        }),
      ),
    );

    const container = mount(<EventList />);
    await settle();
    await settle();

    expect(container.querySelector("tbody tr a[href='#/events/pqc-2026']")).not.toBeNull();
    expect(container.querySelector("tbody tr a[href*='/events/e0000000']")).toBeNull();
    expect(rowActionControlNames(container)).toEqual(["Actions for PQC Conference 2026"]);
  });

  it("offers no group workspace to an event-scoped staff identity that cannot open the group", async () => {
    portalSession.value = portalSessionFixture({
      staff: true,
      grants: [
        { permission: "events:manage", contextType: "event", contextId: "e0000000-0000-4000-8000-000000000009" },
      ],
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json({
          events: [
            managementEventRow({
              id: "e0000000-0000-4000-8000-000000000009",
              ownerGroupId: "20000000-0000-4000-8000-000000000001",
              ownerGroupName: "Post-Quantum Cryptography",
            }),
          ],
          page: { limit: 25, offset: 0, total: 1, hasMore: false },
        }),
      ),
    );

    const container = mount(<EventList />);
    await settle();
    await settle();

    expect(rowActionControlNames(container)).toEqual([]);
    expect(container.querySelector('a[href^="#/groups/"]')).toBeNull();
    expect(container.textContent).toContain("Post-Quantum Cryptography");
    expect(container.querySelector("tbody tr a[href='#/events/pqc-2026']")).not.toBeNull();
  });

  it.each([
    [null, "#/events/pqc-2026"],
    [
      {
        registrationStatus: "registered",
        attendanceType: "in_person",
        waitlisted: false,
        days: [],
        holdsWorkAddress: true,
      },
      "#/events/pqc-2026",
    ],
  ])("opens the event overview for every audience row", async (viewer, expected) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json({
          events: [
            audienceEventRow({
              viewer,
              registrationPath: "/events/pqc-2026/register/",
              city: "Amsterdam",
              country: "NL",
            }),
          ],
          page: { limit: 25, offset: 0, total: 1, hasMore: false },
        }),
      ),
    );
    const container = mount(<EventList />);
    await settle();
    await settle();
    expect(container.querySelector("tbody tr a")?.getAttribute("href")).toBe(expected);
    expect(container.textContent).toContain("Amsterdam");
  });

  it("shows no workspace menu action for an audience entry", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json({
          events: [audienceEventRow()],
          page: { limit: 25, offset: 0, total: 1, hasMore: false },
        }),
      ),
    );

    const container = mount(<EventList />);
    await settle();
    await settle();

    // An audience entry can do nothing to the event, so its row offers no
    // control at all — neither an inline button nor a menu.
    expect(rowActionControlNames(container)).toEqual([]);
  });

  it("opens sponsor leads from an audience row with canonical view or export access", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json({
          events: [audienceEventRow({ sponsorLeadAccess: true })],
          page: { limit: 25, offset: 0, total: 1, hasMore: false },
        }),
      ),
    );
    const container = mount(<EventList />);
    await settle();
    await settle();
    await runRowAction(container, "PQC Conference 2026", "Open sponsor leads");
    expect(navigateMock).toHaveBeenCalledWith("/events/pqc-2026/leads");
    expect(navigateMock.mock.calls.some(([path]) => String(path).includes("/groups/"))).toBe(false);
  });

  it("keeps capture-only scanning available without exposing the contacts route", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json({
          events: [
            audienceEventRow({
              sponsorLeadAccess: false,
              scannerAccess: { canScan: false, sponsors: [{ id: "sponsor-one", name: "Example sponsor" }] },
            }),
          ],
          page: { limit: 25, offset: 0, total: 1, hasMore: false },
        }),
      ),
    );
    const container = mount(<EventList />);
    await settle();
    await settle();
    await runRowAction(container, "PQC Conference 2026", "Scan leads for Example sponsor");
    expect(navigateMock).toHaveBeenCalledWith("/events/pqc-2026/sponsors/sponsor-one/scanner");
    expect(container.textContent).not.toContain("Open sponsor leads");
    expect(navigateMock.mock.calls.some(([path]) => String(path).endsWith("/leads"))).toBe(false);
  });

  it("shows an empty state with no create action when there are no upcoming events", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json({
          events: [],
          page: { limit: 25, offset: 0, total: 0, hasMore: false },
        }),
      ),
    );

    const container = mount(<EventList />);
    await settle();
    await settle();

    expect(container.textContent).toContain("No upcoming events");
    expect([...container.querySelectorAll("button")].some((button) => button.textContent?.includes("Create"))).toBe(
      false,
    );
  });

  it("names the scope group and reports each scope's pressed state", async () => {
    const requests: URL[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        requests.push(new URL(String(input), location.origin));
        return json({ events: [], page: { limit: 25, offset: 0, total: 0, hasMore: false } });
      }),
    );

    const container = mount(<EventList />);
    await settle();
    await settle();

    const scope = container.querySelector('[role="group"][aria-label="Events scope"]')!;
    expect(scope).not.toBeNull();
    const toggles = [...scope.querySelectorAll<HTMLButtonElement>("button[aria-pressed]")];
    expect(toggles.map((button) => [button.textContent, button.getAttribute("aria-pressed")])).toEqual([
      ["Upcoming", "true"],
      ["Past", "false"],
    ]);

    // The table renames itself with the scope, so the two lists are told apart.
    expect(container.querySelector("caption")?.textContent).toBe("Upcoming events");
    const upcoming = eventsListQuerySchema.parse(Object.fromEntries(requests.at(-1)!.searchParams));
    expect(upcoming.from).toBeDefined();
    expect(upcoming.to).toBeUndefined();
    await act(async () => {
      toggles[1].click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await settle();
    expect(container.querySelector("caption")?.textContent).toBe("Past events");
    const past = eventsListQuerySchema.parse(Object.fromEntries(requests.at(-1)!.searchParams));
    expect(past).toMatchObject({ sort: "-starts_at" });
    expect(past.to).toBeDefined();
    expect(past.from).toBeUndefined();
  });

  it("states a refused event listing as a sentence rather than an empty table", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ message: "no" }), {
            status: 403,
            headers: { "content-type": "application/json" },
          }),
      ),
    );

    const container = mount(<EventList />);
    await settle();
    await settle();

    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("You don't have access to this.");
    expect(alert?.textContent).not.toContain("HTTP 403");
    expect(container.querySelector("table")).toBeNull();
  });
});
