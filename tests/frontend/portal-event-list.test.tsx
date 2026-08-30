// @vitest-environment jsdom
import { render, type ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EventList } from "../../assets/ts/member-flows/portal/sections/events/EventList";

vi.mock("wouter/use-hash-location", () => ({ useHashLocation: () => ["", vi.fn()] }));

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

function eventRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "10000000-0000-4000-8000-000000000001",
    slug: "pqc-2026",
    name: "PQC Conference 2026",
    timezone: "UTC",
    startsAt: "2026-09-01T09:00:00.000Z",
    endsAt: "2026-09-01T17:00:00.000Z",
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

afterEach(() => {
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
  vi.unstubAllGlobals();
});

describe("portal event list", () => {
  it("links each row's owning group by name", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json({
          events: [
            eventRow({
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
          events: [eventRow()],
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
});
