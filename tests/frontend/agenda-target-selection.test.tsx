import {
  agendaScheduleProposalSchema,
  agendaScheduleApplySchema,
} from "../../assets/shared/schemas/event-agenda-schedule";
// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, it, expect, vi } from "vitest";
import { AgendaEditor } from "../../assets/ts/member-flows/portal/sections/events/detail/agenda/AgendaEditor";
import { agendaSnapshotSchema, agendaOccurrenceListSchema } from "../../assets/shared/schemas/event-agenda";
import { emptySessionDemandCounts } from "../../assets/shared/schemas/event-session-demand";
import { listFilterOptionsResponseSchema } from "../../assets/shared/schemas/list-filter-options";
import { runRowAction } from "./helpers/row-actions";
const snapshot = agendaSnapshotSchema.parse({
  eventSlug: "synthetic",
  timeZone: "Europe/Amsterdam",
  revision: 7,
  publishedRevision: null,
  rooms: [{ id: "room", name: "Blue hall", capacity: 80 }],
  occurrences: [
    {
      id: "session",
      title: "Original workshop",
      description: "",
      startAt: "2026-12-01T10:00:00.000Z",
      endAt: "2026-12-01T10:30:00.000Z",
      roomId: null,
      speakers: [],
    },
  ],
  blocks: [],
  roleMembers: [],
  assignments: [],
});
let host: HTMLElement;
afterEach(() => {
  render(null, host);
  host.remove();
  vi.unstubAllGlobals();
});
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
async function mount() {
  document.adoptedStyleSheets = [];
  host = document.createElement("div");
  document.body.append(host);
  await act(() => render(<AgendaEditor slug="synthetic" canEdit />, host));
  await settle();
}
describe("touch and keyboard agenda destinations", () => {
  it.each([null, "room"])(
    "keeps the dragged article attached while revealing destinations for room=%s",
    async (roomId) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          json({
            ...snapshot,
            occurrences: snapshot.occurrences.map((row) => ({ ...row, roomId })),
          }),
        ),
      );
      await mount();
      const card = host.querySelector<HTMLElement>('article[data-agenda-occurrence="session"]')!;
      const ancestors = new Set<Node>();
      for (let parent = card.parentNode; parent && parent !== host; parent = parent.parentNode) ancestors.add(parent);
      const removals: Node[] = [];
      const observe = (records: MutationRecord[]) => {
        for (const record of records)
          for (const removed of record.removedNodes)
            if (removed === card || ancestors.has(removed)) removals.push(removed);
      };
      const observer = new MutationObserver(observe);
      observer.observe(host, { childList: true, subtree: true });
      const transfer = { setData: vi.fn(), getData: vi.fn() };
      const start = new Event("dragstart", { bubbles: true });
      Object.defineProperty(start, "dataTransfer", { value: transfer });
      try {
        // This checks browser-event reconciliation and DOM continuity, not native pointer dragging in jsdom.
        await act(() => {
          card.dispatchEvent(start);
        });
        observe(observer.takeRecords());
        expect(transfer.setData).toHaveBeenCalledWith("text/plain", "session");
        expect(host.querySelector(".pk-agenda-editor--native-drag")).not.toBeNull();
        expect(host.querySelector('[role="status"]')?.textContent).toContain("Choose a time and location");
        expect(host.querySelector('[role="status"]')?.textContent).toContain("Original workshop");
        expect(host.querySelectorAll(".pk-agenda-editor__drop").length).toBeGreaterThan(0);
        expect(host.querySelector('article[data-agenda-occurrence="session"]')).toBe(card);
        expect(card.isConnected).toBe(true);
        expect(removals).toEqual([]);
        await act(() => {
          card.dispatchEvent(new Event("dragend", { bubbles: true }));
        });
        observe(observer.takeRecords());
        expect(host.querySelectorAll(".pk-agenda-editor__drop")).toHaveLength(0);
        expect(host.querySelector(".pk-agenda-editor--native-drag")).toBeNull();
        expect(host.querySelector('article[data-agenda-occurrence="session"]')).toBe(card);
        expect(removals).toEqual([]);
      } finally {
        observer.disconnect();
      }
    },
  );
  it.each([
    ["Select for move", "Move selected session"],
    ["Select end time to resize", "End selected session"],
  ])("opens the agenda from the session table for %s and keeps its target across views", async (action, label) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        json(
          String(url).includes("/occurrences/filters")
            ? listFilterOptionsResponseSchema.parse({
                options: [],
                page: { limit: 50, offset: 0, total: 0, hasMore: false },
              })
            : String(url).includes("/occurrences")
              ? agendaOccurrenceListSchema.parse({
                  occurrences: snapshot.occurrences.map((row) => ({
                    ...row,
                    demand: {
                      physical: emptySessionDemandCounts(),
                      remote: emptySessionDemandCounts(),
                    },
                    conflicts: { hasConflict: false, categories: [] },
                  })),
                  page: { limit: 50, offset: 0, total: 1, hasMore: false },
                })
              : snapshot,
        ),
      ),
    );
    await mount();
    const chooseView = async (name: string) => {
      await act(() =>
        [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
          .find((button) => button.textContent === name)!
          .click(),
      );
      await settle();
    };
    await chooseView("All sessions");
    expect(host.querySelector("table")).not.toBeNull();
    await runRowAction(host, "Original workshop", action);
    await settle();
    expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("Agenda");
    expect(host.querySelector(".pk-agenda-editor__drop")?.getAttribute("aria-label")).toContain(label);
    expect(host.querySelector(".pk-agenda-editor--native-drag")).toBeNull();
    expect(host.querySelector('[role="status"]')?.textContent).toContain("Original workshop");
    await chooseView("All sessions");
    await chooseView("Agenda");
    expect(host.querySelector(".pk-agenda-editor__drop")?.getAttribute("aria-label")).toContain(label);
    await act(() => render(<AgendaEditor slug="another-event" canEdit />, host));
    await settle();
    expect(host.querySelectorAll(".pk-agenda-editor__drop")).toHaveLength(0);
  });

  it("clears a cancelled native drag without cancelling a keyboard selection", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(snapshot)),
    );
    await mount();
    const card = host.querySelector<HTMLElement>("article[draggable]")!;
    await act(() => {
      card.dispatchEvent(new Event("dragstart", { bubbles: true }));
    });
    expect(host.querySelectorAll(".pk-agenda-editor__drop").length).toBeGreaterThan(0);
    await act(() => {
      card.dispatchEvent(new Event("dragend", { bubbles: true }));
    });
    expect(host.querySelectorAll(".pk-agenda-editor__drop")).toHaveLength(0);
    await runRowAction(host, "Original workshop", "Select for move");
    await act(() => {
      card.dispatchEvent(new Event("dragend", { bubbles: true }));
    });
    expect(host.querySelectorAll(".pk-agenda-editor__drop").length).toBeGreaterThan(0);
  });

  it("keeps idle session cards without destinations, reveals all locations and cancels with Escape", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(snapshot)),
    );
    await mount();
    expect(host.querySelectorAll(".pk-agenda-editor__drop")).toHaveLength(0);
    expect(host.textContent).toContain("Original workshop");
    await runRowAction(host, "Original workshop", "Select for move");
    const targets = [...host.querySelectorAll<HTMLButtonElement>(".pk-agenda-editor__drop")];
    expect(targets.length).toBeGreaterThan(0);
    expect(targets.some((button) => button.textContent?.includes("Across all locations"))).toBe(true);
    expect(targets.some((button) => button.textContent?.includes("Blue hall"))).toBe(true);
    await act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(host.querySelectorAll(".pk-agenda-editor__drop")).toHaveLength(0);
    expect(host.textContent).toContain("Original workshop");
  });
  it("moves a global session with a null room and current revision, then hides destinations", async () => {
    const bodies: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        if (String(_url).endsWith("/schedule/reviews")) {
          const body = agendaScheduleProposalSchema.parse(JSON.parse(String(init.body)));
          return json({
            expectedRevision: 7,
            reviewHash: "a".repeat(64),
            affected: [
              {
                before: snapshot.occurrences[0],
                after: { ...snapshot.occurrences[0], ...body.changes[0] },
                beforeOrder: 1,
                afterOrder: 1,
              },
            ],
          });
        }
        if (String(_url).endsWith("/schedule")) {
          const body = agendaScheduleApplySchema.parse(JSON.parse(String(init.body)));
          bodies.push(body);
          return json({
            ...snapshot,
            revision: 8,
            occurrences: [{ ...snapshot.occurrences[0], ...body.changes[0] }],
          });
        }
        return json(snapshot);
      }),
    );
    await mount();
    await runRowAction(host, "Original workshop", "Select for move");
    const destination = [...host.querySelectorAll<HTMLButtonElement>(".pk-agenda-editor__drop")].find((button) =>
      button.textContent?.includes("Across all locations"),
    )!;
    await act(async () => {
      destination.click();
      await Promise.resolve();
    });
    await settle();
    expect(bodies).toHaveLength(0);
    await act(async () =>
      [...host.querySelectorAll<HTMLButtonElement>("button")]
        .find((button) => button.textContent === "Apply reviewed schedule")!
        .click(),
    );
    await settle();
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({
      expectedRevision: 7,
      changes: [{ roomId: null, additionalRoomIds: [] }],
    });
    expect(host.querySelectorAll(".pk-agenda-editor__drop")).toHaveLength(0);
    expect(host.textContent).toContain("Original workshop");
  });
  it("switches resize to move and preserves the selected session after a rejected write", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) =>
        init.method === "POST"
          ? json(
              {
                error: {
                  code: "CONFLICT",
                  message: "Another organizer changed the agenda.",
                },
              },
              409,
            )
          : json(snapshot),
      ),
    );
    await mount();
    await runRowAction(host, "Original workshop", "Select end time to resize");
    await runRowAction(host, "Original workshop", "Select for move");
    const destination = host.querySelector<HTMLButtonElement>(".pk-agenda-editor__drop")!;
    expect(destination.getAttribute("aria-label")).toContain("Move selected session");
    await act(async () => {
      destination.click();
      await Promise.resolve();
    });
    await settle();
    expect(host.textContent).toContain("Another organizer changed the agenda.");
    expect(host.querySelectorAll(".pk-agenda-editor__drop")).toHaveLength(0);
    await act(() =>
      [...host.querySelectorAll<HTMLButtonElement>("button")]
        .find((button) => button.textContent === "Cancel schedule changes")!
        .click(),
    );
    expect(host.querySelectorAll(".pk-agenda-editor__drop").length).toBeGreaterThan(0);
    await act(() =>
      [...host.querySelectorAll<HTMLButtonElement>("button")]
        .find((button) => button.textContent === "Cancel selection")!
        .click(),
    );
    expect(host.querySelectorAll(".pk-agenda-editor__drop")).toHaveLength(0);
  });
});
