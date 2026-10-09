import { eventProposalsResponseSchema } from "../../assets/shared/schemas/event-proposals";
import {
  agendaScheduleProposalSchema,
  agendaScheduleApplySchema,
} from "../../assets/shared/schemas/event-agenda-schedule";
// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, it, expect, vi } from "vitest";
import { AgendaPointerPlacement } from "../../assets/ts/member-flows/portal/sections/events/detail/agenda/AgendaPointerPlacement";
import { ContentAgenda } from "../../assets/ts/site/ContentAgenda";
import { agendaRows } from "../../assets/ts/site/agenda-layout";
import { agendaPresenter } from "../../assets/ts/member-flows/portal/sections/events/detail/agenda/presenter";
import { AgendaEditor } from "../../assets/ts/member-flows/portal/sections/events/detail/agenda/AgendaEditor";
import { agendaSnapshotSchema, agendaOccurrenceListSchema } from "../../assets/shared/schemas/event-agenda";
import { emptySessionDemandCounts } from "../../assets/shared/schemas/event-session-demand";
import { listFilterOptionsResponseSchema } from "../../assets/shared/schemas/list-filter-options";
import { runRowAction as runTableRowAction } from "./helpers/row-actions";
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
  shifts: [],
  roleMembers: [],
  assignments: [],
});
let host: HTMLElement;
afterEach(() => {
  render(null, host);
  host.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
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
  await act(() => host.querySelector<HTMLButtonElement>('button[aria-label="Enable agenda editing"]')!.click());
  await settle();
}
function agendaReads(url: string, data = snapshot) {
  if (url.includes("/occurrences/filters"))
    return json(
      listFilterOptionsResponseSchema.parse({ options: [], page: { limit: 50, offset: 0, total: 0, hasMore: false } }),
    );
  if (url.includes("/occurrences"))
    return json(
      agendaOccurrenceListSchema.parse({
        occurrences: data.occurrences.map((row) => ({
          ...row,
          demand: { physical: emptySessionDemandCounts(), remote: emptySessionDemandCounts() },
          conflicts: { hasConflict: false, categories: [] },
        })),
        page: { limit: 50, offset: 0, total: data.occurrences.length, hasMore: false },
      }),
    );
  if (url.includes("/proposals"))
    return json(
      eventProposalsResponseSchema.parse({
        event: { id: "10000000-0000-4000-8000-000000000001", slug: data.eventSlug, name: "Synthetic event" },
        access: {
          eventPermissions: ["proposals:read"],
          canRead: true,
          canReview: false,
          canFinalize: false,
          canEditAcceptedAbstract: false,
          canCancelAcceptedProposal: false,
        },
        proposals: [],
        stats: { byStatus: {}, byRecommendation: {}, reviewedCount: 0, unreviewedCount: 0, total: 0 },
        page: { limit: 50, offset: 0, total: 0, hasMore: false },
      }),
    );
  return json(data);
}
async function runRowAction(root: ParentNode, subject: string, action: string) {
  await act(() => {
    [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
      .find((button) => button.textContent === "Schedule")!
      .click();
  });
  await settle();
  await runTableRowAction(root, subject, action);
  await settle();
}
async function openUnscheduledSources() {
  const source = host.querySelector<HTMLButtonElement>('button[aria-controls^="agenda-sources-"]')!;
  if (source.getAttribute("aria-expanded") !== "true") await act(() => source.click());
  expect(source.getAttribute("aria-pressed")).toBe("true");
  expect(source.getAttribute("aria-label")).toBe("Hide session sources");
  expect(source.querySelector("svg path")?.getAttribute("d")).toBe("M10 2v12M4 5l3 3-3 3");
  await settle();
  await act(() => {
    [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
      .find((button) => button.textContent === "Unscheduled sessions")!
      .click();
  });
  await settle();
}
describe("touch and keyboard agenda destinations", () => {
  it.each(["move", "resize", "cancel", "locked"] as const)(
    "tracks continuous pointer %s on the shared card without native drag or occupied-cell targets",
    async (mode) => {
      const data = agendaSnapshotSchema.parse({
        ...snapshot,
        eventStartsAt: "2026-12-01T10:00:00.000Z",
        eventEndsAt: "2026-12-01T12:00:00.000Z",
        occurrences: snapshot.occurrences.map((row) => ({ ...row, roomId: "room" })),
      });
      const before = JSON.stringify(data);
      const move = vi.fn();
      const resize = vi.fn();
      vi.stubGlobal(
        "CSSStyleSheet",
        class {
          replaceSync = vi.fn();
        },
      );
      document.adoptedStyleSheets = [];
      vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
        const start = this.dataset.agendaStart;
        const top = start ? 100 + (Date.parse(start) - Date.parse(data.eventStartsAt!)) / 30000 : 100;
        return new DOMRect(this.matches("thead th:first-child") ? 0 : 100, top, 200, 10);
      });
      host = document.createElement("div");
      document.body.append(host);
      await act(() =>
        render(
          <AgendaPointerPlacement snapshot={data} disabled={mode === "locked"} onMove={move} onResize={resize}>
            <ContentAgenda
              days={agendaPresenter(data)}
              speakers={[]}
              timeZone={data.timeZone}
              editor={{
                session: () => ({
                  controls: null,
                  resizeHandle: <button class="pk-agenda-editor__resize">Resize</button>,
                }),
                dropTarget: () => null,
              }}
            />
          </AgendaPointerPlacement>,
          host,
        ),
      );
      const coordinator = host.querySelector<HTMLElement>(".pk-agenda-editor__pointer-calendar")!;
      let captured = false;
      coordinator.setPointerCapture = () => {
        captured = true;
      };
      coordinator.hasPointerCapture = () => captured;
      coordinator.releasePointerCapture = () => {
        captured = false;
      };
      const card = host.querySelector<HTMLElement>("[data-agenda-occurrence]")!;
      function pointer(target: HTMLElement, name: string, y: number) {
        const event = new Event(name, { bubbles: true, cancelable: true });
        Object.assign(event, {
          pointerId: 1,
          pointerType: mode === "resize" ? "touch" : "mouse",
          button: 0,
          clientX: 150,
          clientY: y,
        });
        target.dispatchEvent(event);
      }
      await act(() => {
        pointer(
          mode === "resize" ? card.querySelector<HTMLElement>(".pk-agenda-editor__resize")! : card,
          "pointerdown",
          mode === "resize" ? 160 : 120,
        );
        pointer(coordinator, "pointermove", mode === "resize" ? 140 : 180);
      });
      expect(card.draggable).toBe(false);
      expect(host.querySelector("[data-agenda-occurrence]")).toBe(card);
      expect(card.isConnected).toBe(true);
      const preview = document.querySelector(".pk-agenda-editor__pointer-preview");
      expect(Boolean(preview)).toBe(mode !== "locked");
      if (preview) {
        expect(preview.textContent).toContain("Original workshop");
        expect(preview.getAttribute("aria-hidden")).toBe("true");
        expect(preview.hasAttribute("style")).toBe(false);
        expect(document.adoptedStyleSheets).toHaveLength(1);
      }
      await act(() =>
        pointer(coordinator, mode === "cancel" ? "pointercancel" : "pointerup", mode === "resize" ? 140 : 180),
      );
      if (mode === "move") expect(move).toHaveBeenCalledWith("session", "2026-12-01T10:30:00.000Z", "room");
      else expect(move).not.toHaveBeenCalled();
      if (mode === "resize") expect(resize).toHaveBeenCalledWith("session", "2026-12-01T10:20:00.000Z", "room");
      else expect(resize).not.toHaveBeenCalled();
      expect(document.querySelector(".pk-agenda-editor__pointer-preview")).toBeNull();
      expect(document.adoptedStyleSheets).toHaveLength(0);
      expect(card.hasAttribute("data-agenda-pointer-source")).toBe(false);
      expect(JSON.stringify(data)).toBe(before);
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
    await chooseView("Schedule");
    expect(host.querySelector("table")).not.toBeNull();
    await runRowAction(host, "Original workshop", action);
    await settle();
    expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("Agenda");
    expect(host.querySelector(".pk-agenda-editor__drop")?.getAttribute("aria-label")).toContain(label);
    expect(host.querySelector(".pk-agenda-editor--native-drag")).toBeNull();
    expect(host.querySelector('[role="status"]')?.textContent).toContain("Original workshop");
    await chooseView("Schedule");
    await chooseView("Agenda");
    expect(host.querySelector(".pk-agenda-editor__drop")?.getAttribute("aria-label")).toContain(label);
    await act(() => render(<AgendaEditor slug="another-event" canEdit />, host));
    await settle();
    expect(host.querySelectorAll(".pk-agenda-editor__drop")).toHaveLength(0);
  });

  it("clears a cancelled native dock drag without cancelling a keyboard selection", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        agendaReads(
          url,
          agendaSnapshotSchema.parse({
            ...snapshot,
            occurrences: [
              ...snapshot.occurrences,
              { ...snapshot.occurrences[0], id: "backlog", title: "Waiting workshop", startAt: null, endAt: null },
            ],
          }),
        ),
      ),
    );
    await mount();
    await openUnscheduledSources();
    let card = host.querySelector<HTMLElement>('article[data-agenda-occurrence="backlog"]')!;
    expect(card.draggable).toBe(true);
    expect(host.querySelector<HTMLElement>('article[data-agenda-occurrence="session"]')!.draggable).toBe(false);
    const transfer = { setData: vi.fn(), setDragImage: vi.fn() };
    const start = new Event("dragstart", { bubbles: true });
    Object.defineProperty(start, "dataTransfer", { value: transfer });
    await act(() => {
      card.dispatchEvent(start);
    });
    expect(transfer.setData).toHaveBeenCalledWith("text/plain", "backlog");
    expect(transfer.setDragImage.mock.calls[0][0]).toBe(card);
    expect(host.querySelectorAll(".pk-agenda-editor__drop").length).toBeGreaterThan(0);
    await act(() => {
      card.dispatchEvent(new Event("dragend", { bubbles: true }));
    });
    expect(host.querySelectorAll(".pk-agenda-editor__drop")).toHaveLength(0);
    await runRowAction(host, "Original workshop", "Select for move");
    await openUnscheduledSources();
    card = host.querySelector<HTMLElement>('article[data-agenda-occurrence="backlog"]')!;
    await act(() => {
      card.dispatchEvent(new Event("dragend", { bubbles: true }));
    });
    expect(host.querySelectorAll(".pk-agenda-editor__drop").length).toBeGreaterThan(0);
  });

  it("keeps idle session cards without destinations, reveals all locations and cancels with Escape", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => agendaReads(url)),
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
        return agendaReads(String(_url));
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
    expect(bodies).toHaveLength(1);
    expect(host.textContent).not.toContain("Apply reviewed schedule");
    expect(bodies[0]).toMatchObject({
      expectedRevision: 7,
      reviewHash: "a".repeat(64),
      changes: [{ id: "session", roomId: null, additionalRoomIds: [] }],
    });
    expect(host.querySelectorAll(".pk-agenda-editor__drop")).toHaveLength(0);
    expect(host.textContent).toContain("Original workshop");
  });
  it("switches resize to move and preserves the selected session after a rejected write", async () => {
    const reviews: unknown[] = [];
    const apply = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        if (init.method === "POST") {
          if (_url.endsWith("/schedule/reviews"))
            reviews.push(agendaScheduleProposalSchema.parse(JSON.parse(String(init.body))));
          else apply(agendaScheduleApplySchema.parse(JSON.parse(String(init.body))));
          return json({ error: { code: "CONFLICT", message: "Another organizer changed the agenda." } }, 409);
        }
        return agendaReads(String(_url));
      }),
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
    expect(reviews).toHaveLength(1);
    expect(apply).not.toHaveBeenCalled();
    expect(host.querySelectorAll(".pk-agenda-editor__drop").length).toBeGreaterThan(0);
    expect(host.querySelector('[role="status"]')?.textContent).toContain("Original workshop");
    expect(host.textContent).not.toContain("Cancel schedule changes");
    await act(async () => {
      destination.click();
      await Promise.resolve();
    });
    await settle();
    expect(reviews).toHaveLength(2);
    expect(apply).not.toHaveBeenCalled();
    await act(() =>
      [...host.querySelectorAll<HTMLButtonElement>("button")]
        .find((button) => button.textContent === "Cancel selection")!
        .click(),
    );
    expect(host.querySelectorAll(".pk-agenda-editor__drop")).toHaveLength(0);
  });
});

it.each(["move", "resize"] as const)(
  "maps a compressed break's rendered row boxes to exact UTC for %s",
  async (mode) => {
    const data = agendaSnapshotSchema.parse({
      ...snapshot,
      timeZone: "UTC",
      eventStartsAt: "2026-12-01T10:00:00.000Z",
      eventEndsAt: "2026-12-01T12:00:00.000Z",
      occurrences: [
        { ...snapshot.occurrences[0], id: "break", title: "Lunch", kind: "break", endAt: "2026-12-01T11:00:00.000Z" },
        {
          ...snapshot.occurrences[0],
          roomId: "room",
          startAt: "2026-12-01T11:00:00.000Z",
          endAt: "2026-12-01T11:30:00.000Z",
        },
      ],
    });
    const before = JSON.stringify(data);
    const day = agendaPresenter(data)[0]!;
    const rows = agendaRows(day, 0, true);
    expect(rows.slice(0, 12).reduce((sum, row) => sum + row.height, 0)).toBe(60);
    const bounds = new Map<string, { top: number; height: number }>();
    let top = 100;
    for (const row of rows) {
      bounds.set(row.slot.startsAt, { top, height: row.height });
      top += row.height;
    }
    vi.stubGlobal(
      "CSSStyleSheet",
      class {
        replaceSync = vi.fn();
      },
    );
    document.adoptedStyleSheets = [];
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const instant =
        this.dataset.agendaStart ?? this.closest<HTMLElement>("tr[data-agenda-start]")?.dataset.agendaStart;
      const row = instant ? bounds.get(instant) : undefined;
      return new DOMRect(
        this.matches("thead th:first-child") ? 0 : 96,
        row?.top ?? 100,
        this.matches("thead th:first-child") ? 96 : 340,
        row?.height ?? 60,
      );
    });
    const move = vi.fn();
    const resize = vi.fn();
    host = document.createElement("div");
    document.body.append(host);
    await act(() =>
      render(
        <AgendaPointerPlacement snapshot={data} disabled={false} onMove={move} onResize={resize}>
          <ContentAgenda
            days={[day]}
            speakers={[]}
            timeZone="UTC"
            editor={{
              session: () => ({
                controls: null,
                resizeHandle: <button class="pk-agenda-editor__resize">Resize</button>,
              }),
              dropTarget: () => null,
            }}
          />
        </AgendaPointerPlacement>,
        host,
      ),
    );
    const coordinator = host.querySelector<HTMLElement>(".pk-agenda-editor__pointer-calendar")!;
    let captured = false;
    coordinator.setPointerCapture = () => {
      captured = true;
    };
    coordinator.hasPointerCapture = () => captured;
    coordinator.releasePointerCapture = () => {
      captured = false;
    };
    const card = host.querySelector<HTMLElement>('[data-agenda-occurrence="break"]')!;
    const target = mode === "resize" ? card.querySelector<HTMLElement>(".pk-agenda-editor__resize")! : card;
    await act(() => {
      for (const [element, type, y] of [
        [target, "pointerdown", mode === "resize" ? 155 : 105],
        [coordinator, "pointermove", 135],
        [coordinator, "pointerup", 135],
      ] as const) {
        const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: 150, clientY: y });
        Object.defineProperty(event, "pointerId", { value: 1 });
        element.dispatchEvent(event);
      }
    });
    if (mode === "move") {
      expect(move).toHaveBeenCalledWith("break", "2026-12-01T10:30:00.000Z", "room");
      expect(resize).not.toHaveBeenCalled();
    } else {
      expect(resize).toHaveBeenCalledWith("break", "2026-12-01T10:35:00.000Z", "");
      expect(move).not.toHaveBeenCalled();
    }
    expect(host.querySelector('[data-agenda-occurrence="break"]')).toBe(card);
    expect(host.querySelectorAll("tr[data-agenda-start]")).toHaveLength(rows.length);
    expect(document.querySelector(".pk-agenda-editor__pointer-preview")).toBeNull();
    expect(JSON.stringify(data)).toBe(before);
  },
);
