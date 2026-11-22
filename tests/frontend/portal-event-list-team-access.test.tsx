// @vitest-environment jsdom
import { type ComponentChildren } from "preact";
import { describe, expect, it, vi } from "vitest";
import { EventList } from "../../assets/ts/member-flows/portal/sections/events/EventList";
import { rowActionControlNames, runRowAction } from "./helpers/row-actions";
import { portalSession } from "../../assets/ts/member-flows/portal/state";
import { portalSessionFixture } from "../helpers/portal-session";
import { managementEventRow, audienceEventRow } from "./helpers/event-list-fixtures";
import { json, mount, settle, useEventListHarness } from "./helpers/event-list-harness";

const { navigateMock } = vi.hoisted(() => ({ navigateMock: vi.fn() }));

vi.mock("wouter/use-hash-location", () => ({ useHashLocation: () => ["", navigateMock] }));
vi.mock("wouter", () => ({
  Link: ({ children, href }: { children?: ComponentChildren; href: string }) => <a href={`#${href}`}>{children}</a>,
}));

useEventListHarness(navigateMock);

describe("portal event list for an event's team", () => {
  it("offers no group workspace to a staff identity scoped to another event", async () => {
    portalSession.value = portalSessionFixture({
      staff: true,
      grants: [
        { permission: "events:manage", contextType: "event", contextId: "e0000000-0000-4000-8000-000000000008" },
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

  it("offers the owning group to the event's team, who open it as a guest", async () => {
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

    expect(rowActionControlNames(container)).toEqual(["Actions for PQC Conference 2026"]);
    expect(container.querySelector('a[href="#/groups/20000000-0000-4000-8000-000000000001"]')?.textContent).toBe(
      "Post-Quantum Cryptography",
    );
    expect(container.querySelector("tbody tr a[href='#/events/pqc-2026']")).not.toBeNull();
  });

  it("lets a volunteer who is not a group member open their event's record from an audience row", async () => {
    portalSession.value = portalSessionFixture({
      staff: true,
      grants: [{ permission: "agenda:scan", contextType: "event", contextId: "10000000-0000-4000-8000-000000000002" }],
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json({
          events: [audienceEventRow({ ownerGroupId: "20000000-0000-4000-8000-000000000001" })],
          page: { limit: 25, offset: 0, total: 1, hasMore: false },
        }),
      ),
    );

    const container = mount(<EventList />);
    await settle();
    await settle();

    await runRowAction(container, "PQC Conference 2026", "Open in group");
    expect(navigateMock).toHaveBeenCalledWith(
      "/groups/20000000-0000-4000-8000-000000000001/events/10000000-0000-4000-8000-000000000002",
    );
  });
});
