// @vitest-environment jsdom
import { agendaBlocksQuerySchema, agendaBlocksListSchema } from "../../assets/shared/schemas/event-agenda-block-list";
import { buildPageInfo } from "../../assets/shared/schemas/pagination";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, it, expect, vi } from "vitest";
import { runRowAction } from "./helpers/row-actions";
import { StaffingEditor } from "../../assets/ts/member-flows/portal/sections/events/detail/agenda/StaffingEditor";
import {
  agendaSnapshotSchema,
  agendaAllocationSchema,
  agendaStaffingSchema,
} from "../../assets/shared/schemas/event-agenda";
// Renderer seam: keep real hash navigation while using the production Preact hook runtime.
vi.mock("wouter/use-hash-location", async () => {
  const { useSyncExternalStore } = await import("preact/compat");
  const read = () => "/" + window.location.hash.replace(/^#?\/?/, "");
  const subscribe = (changed: () => void) => {
    window.addEventListener("hashchange", changed);
    return () => window.removeEventListener("hashchange", changed);
  };
  return {
    useHashLocation: () => [
      useSyncExternalStore(subscribe, read),
      (to: string) => {
        window.location.hash = to;
      },
    ],
  };
});
const snapshot = agendaSnapshotSchema.parse({
  eventSlug: "synthetic",
  timeZone: "Europe/Amsterdam",
  revision: 4,
  publishedRevision: null,
  rooms: [],
  occurrences: [],
  blocks: [
    {
      id: "block",
      name: "Opening to coffee",
      startAt: "2026-12-01T10:00:00.000Z",
      endAt: "2026-12-01T11:00:00.000Z",
      roomId: null,
      roles: ["mc"],
    },
  ],
  roleMembers: [
    {
      userId: "second",
      displayName: "Synthetic Second",
      roles: ["mc"],
      availableFrom: null,
      availableUntil: null,
      maxMinutes: null,
    },
    {
      userId: "senior",
      displayName: "Synthetic Senior",
      roles: ["mc"],
      availableFrom: null,
      availableUntil: null,
      maxMinutes: null,
    },
  ],
  staffingRoles: [{ id: "mc", name: "Master of ceremonies" }],
  staffingPosts: [{ id: "door", name: "Main door", roomId: null }],
  staffingRequirements: [{ id: "need", blockId: "block", roleId: "mc", postId: "door", idealCount: 3 }],
  staffingPositions: [1, 2, 3].map((index) => ({ id: `position-${index}`, requirementId: "need", index })),
  assignments: [
    { positionId: "position-1", blockId: "block", role: "mc", postId: "door", userId: "senior", pinned: true },
    { positionId: "position-2", blockId: "block", role: "mc", postId: "door", userId: "second", pinned: true },
  ],
});
let host: HTMLElement;
afterEach(() => {
  render(null, host);
  host.remove();
  vi.unstubAllGlobals();
});
async function mount(canEdit = true) {
  const previousFetch = globalThis.fetch;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const source = new URL(String(url), "https://pkic.org");
      if (source.pathname === "/api/v1/events/synthetic/agenda/blocks") {
        const query = agendaBlocksQuerySchema.parse(Object.fromEntries(source.searchParams));
        return Response.json(
          agendaBlocksListSchema.parse({
            blocks: snapshot.blocks,
            page: buildPageInfo(query.limit, query.offset, snapshot.blocks.length, snapshot.blocks.length),
          }),
        );
      }
      return previousFetch(url, init);
    }),
  );
  host = document.createElement("div");
  document.body.append(host);
  await act(async () => {
    render(<StaffingEditor snapshot={snapshot} canEdit={canEdit} onSaved={() => {}} />, host);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
async function openRotation() {
  await runRowAction(host, "Event staffing", "Configure rotation");
}

function capture() {
  const bodies: unknown[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (!init?.body)
        return new Response(JSON.stringify({ options: [], page: { limit: 25, offset: 0, total: 0, hasMore: false } }), {
          headers: { "content-type": "application/json" },
        });
      bodies.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify(snapshot), { headers: { "content-type": "application/json" } });
    }),
  );
  return bodies;
}
async function openPositions() {
  await runRowAction(host, "Opening to coffee", "Review staffing");
  await runRowAction(host, "Master of ceremonies · Main door", "Review positions");
}
describe("staffing canonical actions", () => {
  it("keeps actionable current shortfall reasons visible after successful generation", async () => {
    const saved = agendaSnapshotSchema.parse({
      ...snapshot,
      staffingReport: {
        people: [],
        coverage: [],
        boundaryChanges: [],
        uncovered: [
          {
            blockId: "block",
            role: "mc",
            postId: "door",
            positionId: "position-3",
            eligiblePeople: 0,
            reasons: [{ reason: "conflict", people: 2 }],
          },
        ],
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(saved), { headers: { "content-type": "application/json" } })),
    );
    await mount();
    const show = () =>
      render(
        <StaffingEditor
          snapshot={snapshot}
          canEdit
          onSaved={(next) => render(<StaffingEditor snapshot={next} canEdit onSaved={() => {}} />, host)}
        />,
        host,
      );
    await act(show);
    await openRotation();
    await act(() => {
      const input = host.querySelector<HTMLInputElement>('[name="seed"]')!;
      input.value = "shortfall-review";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(host.querySelector("form")).toBeNull();
    expect(host.textContent).toContain("Assignments generated.");
    expect(host.textContent).not.toContain("Another duty or talk conflicts");
    await openPositions();
    expect(host.textContent).toContain("Another duty or talk conflicts, including travel (2 people)");
    expect(host.textContent).toContain("Main door");
    expect(host.textContent).toContain("No eligible person can cover this position with the current plan.");
  });

  it("generates a saved seeded rotation using the guarded allocation contract", async () => {
    const bodies = capture();
    await mount();
    expect(host.querySelector("form")).toBeNull();
    await openRotation();
    expect(host.querySelector('[aria-label="Staffing workload roster"]')).toBeNull();
    expect(host.textContent).not.toContain("2 assigned · 3 ideal · 1 unfilled");
    await act(() => {
      const input = host.querySelector<HTMLInputElement>('[name="seed"]')!;
      input.value = "December conference";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const body = agendaAllocationSchema.parse(bodies[0]);
    expect(body.expectedRevision).toBe(4);
    expect(body.seed).toBe("December conference");
    await openPositions();
    expect(host.textContent).toContain("Pinned");
    expect(host.querySelector("form")).toBeNull();
    expect(host.textContent).toContain("Assignments generated.");
  });
  it("cancels the dedicated rotation view without mutating the staffing plan", async () => {
    const bodies = capture();
    await mount();
    await openRotation();
    expect(host.querySelector("form")).not.toBeNull();
    await act(() => [...host.querySelectorAll("button")].find((button) => button.textContent === "Cancel")!.click());
    expect(host.querySelector("form")).toBeNull();
    expect(host.querySelector("table")?.getAttribute("class")).toBeTruthy();
    expect(bodies).toHaveLength(0);
  });
  it("keeps refused generation in its dedicated view with entered configuration", async () => {
    const bodies = capture();
    await mount();
    await openRotation();
    await act(() => {
      const input = host.querySelector<HTMLInputElement>('[name="seed"]')!;
      input.value = "Reviewed seed";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click();
    });
    await act(async () => {
      host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(bodies).toHaveLength(0);
    expect(host.querySelector<HTMLInputElement>('[name="seed"]')!.value).toBe("Reviewed seed");
    expect(host.textContent).toContain("Configure rotation");
    expect(host.textContent).not.toContain("2 assigned · 3 ideal · 1 unfilled");
  });
  it("shows no editing form or rotation action to a read-only viewer", async () => {
    await mount(false);
    expect(host.querySelector("form")).toBeNull();
    expect(host.textContent).not.toContain("Configure rotation");
    expect(host.querySelector("table")?.getAttribute("class")).toBeTruthy();
  });
  it("cancels dedicated assignment editing without writing and keeps overview controls compact", async () => {
    const bodies = capture();
    await mount();
    expect(host.querySelectorAll('select,input:not([type="search"]):not([type="checkbox"])')).toHaveLength(0);
    expect(host.querySelector('input[type="search"]')).not.toBeNull();
    expect(host.textContent).not.toContain("0 uncovered duties");
    expect(host.textContent).not.toContain("Allocate configured duties and posts across the event.");
    await openPositions();
    await runRowAction(host, "Position 1", "Edit assignment");
    expect(host.querySelector("table")).toBeNull();
    await act(() => [...host.querySelectorAll("button")].find((row) => row.textContent === "Cancel")!.click());
    expect(host.querySelector("form")).toBeNull();
    expect(host.querySelectorAll('select,input:not([type="search"]):not([type="checkbox"])')).toHaveLength(0);
    expect(bodies).toHaveLength(0);
  });
  it("unpins a senior assignment without changing its person or block", async () => {
    const bodies = capture();
    await mount();
    await openPositions();
    await runRowAction(host, "Position 1", "Edit assignment");
    expect(host.querySelector("table")).toBeNull();
    await act(() => host.querySelector<HTMLInputElement>('[name="pinned"]')!.click());
    await act(async () => {
      host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    const body = agendaStaffingSchema.parse(bodies[0]);
    expect(body.assignments.find((row) => row.positionId === "position-1")).toMatchObject({
      pinned: false,
      userId: "senior",
      blockId: "block",
      postId: "door",
    });
    expect(body.assignments.find((row) => row.positionId === "position-2")).toEqual(snapshot.assignments[1]);
    expect(body.staffingPositions).toEqual(snapshot.staffingPositions);
    expect(body.staffingRequirements).toEqual(snapshot.staffingRequirements);
  });
  it("shows separate positions and unfilled ideal headcount without disabling generation", async () => {
    await mount();
    expect(host.querySelector("table")?.getAttribute("class")).toBeTruthy();
    expect(host.querySelectorAll("select")).toHaveLength(0);
    expect(host.querySelector("form")).toBeNull();
    await openRotation();
    expect(host.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(false);
  });
  it("increases ideal count with stable existing position IDs and preserves both pinned assignees", async () => {
    const bodies = capture();
    await mount();
    await runRowAction(host, "Opening to coffee", "Staffing needs");
    await act(() => {
      const count = host.querySelector<HTMLInputElement>('[name="staffingRequirements.0.idealCount"]')!;
      count.value = "4";
      count.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    const body = agendaStaffingSchema.parse(bodies[0]);
    expect(body.staffingRequirements[0].idealCount).toBe(4);
    expect(body.staffingPositions.slice(0, 3)).toEqual(snapshot.staffingPositions);
    expect(body.staffingPositions[3]).toMatchObject({ requirementId: "need", index: 4 });
    expect(body.assignments).toEqual(snapshot.assignments);
  });
  it("keeps role publication private by default and saves an explicit public choice when renaming", async () => {
    const bodies = capture();
    await mount();
    await runRowAction(host, "Event staffing", "Roles and posts");
    const visibility = host.querySelector<HTMLInputElement>('[name="staffingRoles.0.showOnAgenda"]')!;
    expect(visibility.checked).toBe(false);
    await act(() => visibility.click());
    await act(() => {
      const name = host.querySelector<HTMLInputElement>('[name="staffingRoles.0.name"]')!;
      name.value = "Public host";
      name.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    const body = agendaStaffingSchema.parse(bodies[0]);
    expect(body.staffingRoles[0]).toEqual({ id: "mc", name: "Public host", showOnAgenda: true });
    expect(body.assignments).toEqual(snapshot.assignments);
  });
  it("saves an empty planning block before configuring its ideal staffing needs", async () => {
    const bodies = capture();
    await mount();
    const toolbar = host.querySelector('[role="toolbar"][aria-label="Staffing blocks controls"]');
    expect(toolbar).not.toBeNull();
    const create = toolbar!.querySelector<HTMLButtonElement>('button[aria-label="New block"]');
    expect(create).not.toBeNull();
    expect(create?.disabled).toBe(false);
    await act(() => create!.click());
    for (const [name, value] of [
      ["blocks.1.name", "Afternoon door coverage"],
      ["startAt", "2026-12-01T14:00"],
      ["endAt", "2026-12-01T15:00"],
    ]) {
      await act(() => {
        const input = host.querySelector<HTMLInputElement>(`[name="${name}"]`)!;
        input.value = value!;
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    }
    await act(async () => {
      host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(bodies).toHaveLength(1);
    const body = agendaStaffingSchema.parse(bodies[0]);
    expect(body.blocks[1]).toMatchObject({
      name: "Afternoon door coverage",
      roles: [],
      startAt: "2026-12-01T13:00:00.000Z",
      endAt: "2026-12-01T14:00:00.000Z",
    });
    expect(body.staffingRequirements).toEqual(snapshot.staffingRequirements);
    expect(body.staffingPositions).toEqual(snapshot.staffingPositions);
    expect(body.assignments).toEqual(snapshot.assignments);
  });
  it("edits a saved block without changing its stable ID or pinned assignments", async () => {
    const bodies = capture();
    await mount();
    await runRowAction(host, "Opening to coffee", "Edit block");
    await act(() => {
      const input = host.querySelector<HTMLInputElement>('[name="blocks.0.name"]')!;
      input.value = "Coffee to lunch";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });
    const body = agendaStaffingSchema.parse(bodies[0]);
    expect(body.blocks[0]).toMatchObject({
      id: "block",
      name: "Coffee to lunch",
      startAt: snapshot.blocks[0].startAt,
      endAt: snapshot.blocks[0].endAt,
    });
    expect(body.assignments).toEqual(snapshot.assignments);
  });
});
