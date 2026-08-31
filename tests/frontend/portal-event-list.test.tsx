// @vitest-environment jsdom
import { render, type ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EventList } from "../../assets/ts/member-flows/portal/sections/events/EventList";

const { navigateMock } = vi.hoisted(() => ({ navigateMock: vi.fn() }));

vi.mock("wouter/use-hash-location", () => ({ useHashLocation: () => ["", navigateMock] }));
vi.mock("wouter", () => ({
  Link: ({ children, href }: { children?: ComponentChildren; href: string }) => <a href={`#${href}`}>{children}</a>,
}));

const mounted: HTMLElement[] = [];

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
    location: null,
    links: [],
    basePath: "/events/pqc-2026",
    viewer: null,
    ...overrides,
  };
}

afterEach(() => {
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
  vi.unstubAllGlobals();
  navigateMock.mockReset();
});

describe("portal event list", () => {
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
    expect(row.querySelector("a")).toBeNull();
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
    expect(row.textContent).toContain("Registered");
    expect(row.textContent).toContain("In person");
    const viewerLink = [...row.querySelectorAll("a")].find((a) => a.getAttribute("href") === "#/participation");
    expect(viewerLink).toBeTruthy();
  });

  it("offers an 'Open in group workspace' menu action for a management-capable entry", async () => {
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

    const trigger = container.querySelector<HTMLButtonElement>('[aria-label="Actions for PQC Conference 2026"]');
    expect(trigger).not.toBeNull();
    void act(() => trigger!.click());

    const menuItem = [...container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((button) =>
      button.textContent?.includes("Open in Post-Quantum Cryptography workspace"),
    );
    expect(menuItem).toBeTruthy();
    void act(() => menuItem!.click());

    expect(navigateMock).toHaveBeenCalledWith(
      "/groups/20000000-0000-4000-8000-000000000001/events/e0000000-0000-4000-8000-000000000009",
    );
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

    expect(container.querySelector('[aria-label="Actions for PQC Conference 2026"] ~ [role="menu"]')).toBeNull();
    const trigger = container.querySelector<HTMLButtonElement>('[aria-label="Actions for PQC Conference 2026"]');
    // The trigger itself is only rendered by Menu when there is at least one action.
    expect(trigger).toBeNull();
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
});
