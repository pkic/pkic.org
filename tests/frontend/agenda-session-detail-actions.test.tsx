import {
  agendaScheduleProposalSchema,
  agendaScheduleApplySchema,
  agendaScheduleReviewSchema,
} from "../../assets/shared/schemas/event-agenda-schedule";
// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  agendaOccurrenceListSchema,
  agendaOccurrencePatchSchema,
  agendaOccurrenceQuerySchema,
  agendaSnapshotSchema,
} from "../../assets/shared/schemas/event-agenda";
import { AgendaEditor } from "../../assets/ts/member-flows/portal/sections/events/detail/agenda/AgendaEditor";
import { agendaSessionActions } from "../../assets/ts/member-flows/portal/sections/events/detail/agenda/session-actions";
import { roomRecommendationsResponseSchema } from "../../assets/shared/schemas/event-room-recommendations";
import { openCardMenu, runRowAction } from "./helpers/row-actions";

const snapshot = agendaSnapshotSchema.parse({
  eventSlug: "detail-actions",
  timeZone: "Europe/Amsterdam",
  revision: 7,
  publishedRevision: null,
  rooms: [{ id: "room", name: "Blue hall", capacity: 80 }],
  occurrences: [
    {
      id: "session",
      title: "Canonical workshop",
      description: "Session abstract",
      startAt: "2026-12-01T10:00:00.000Z",
      endAt: "2026-12-01T10:30:00.000Z",
      roomId: "room",
      speakers: [],
    },
  ],
  shifts: [],
  roleMembers: [],
  assignments: [],
});
let host: HTMLElement | undefined;
afterEach(() => {
  if (host) {
    render(null, host);
    host.remove();
    host = undefined;
  }
  vi.unstubAllGlobals();
  history.replaceState(null, "", "/portal/#/events/detail-actions/agenda");
});
const json = (value: unknown) =>
  new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
async function mount(canEdit = true, canReviewAppearances = false) {
  document.adoptedStyleSheets = [];
  host = document.createElement("div");
  document.body.append(host);
  await act(() =>
    render(
      <AgendaEditor slug={snapshot.eventSlug} canEdit={canEdit} canReviewAppearances={canReviewAppearances} />,
      host!,
    ),
  );
  await settle();
  if (canEdit) {
    await act(() => host!.querySelector<HTMLButtonElement>('button[aria-label="Enable agenda editing"]')!.click());
    await settle();
  }
}
function reads(input: RequestInfo | URL) {
  const url = new URL(String(input), "https://example.test");
  if (url.pathname.endsWith("/room-recommendations"))
    return json(
      roomRecommendationsResponseSchema.parse({
        occurrenceId: snapshot.occurrences[0].id,
        revision: snapshot.revision,
        demand: {
          physical: { confirmed: 0, pending: 0, waitlisted: 0, preferences: 0, occupied: 0 },
          remote: { confirmed: 0, pending: 0, waitlisted: 0, preferences: 0, occupied: 0 },
        },
        recommendations: [],
      }),
    );
  if (url.pathname.endsWith("/filters"))
    return json({ options: [], page: { limit: 50, offset: 0, total: 0, hasMore: false } });
  if (url.pathname.endsWith("/occurrences")) {
    const query = agendaOccurrenceQuerySchema.parse(Object.fromEntries(url.searchParams));
    return json(
      agendaOccurrenceListSchema.parse({
        occurrences: snapshot.occurrences.map((row) => ({
          ...row,
          demand: {
            physical: { confirmed: 0, pending: 0, waitlisted: 0, preferences: 0 },
            remote: { confirmed: 0, pending: 0, waitlisted: 0, preferences: 0 },
          },
          conflicts: { hasConflict: false, categories: [] },
        })),
        page: { limit: query.limit, offset: query.offset, total: 1, hasMore: false },
      }),
    );
  }
  return json(snapshot);
}
async function openDetail() {
  const dialog = host!.querySelector<HTMLDialogElement>('article[data-agenda-occurrence="session"] dialog')!;
  dialog.showModal = () => {
    dialog.open = true;
  };
  dialog.close = vi.fn(() => {
    dialog.open = false;
  });
  await act(() =>
    host!.querySelector<HTMLButtonElement>('[aria-label="Open session details: Canonical workshop"]')!.click(),
  );
  expect(dialog.open).toBe(true);
  return dialog;
}
async function inputTitle(value: string) {
  await act(() => {
    const input = host!.querySelector<HTMLInputElement>('[name="title"]')!;
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await settle();
}
const commands = (items: HTMLButtonElement[]) =>
  items.map((item) => ({ label: item.textContent, disabled: item.disabled }));

describe("shared session actions in details", () => {
  it.each(["move", "swap", "locations"] as const)(
    "keeps the calendar and %s choices on a refused guarded command, then saves the exact retry",
    async (action) => {
      const data = agendaSnapshotSchema.parse({
        ...snapshot,
        rooms: [
          ...snapshot.rooms,
          { id: "second-room", name: "Green hall", capacity: 80 },
          { id: "third-room", name: "Orange hall", capacity: 80 },
        ],
        occurrences: [
          ...snapshot.occurrences,
          {
            ...snapshot.occurrences[0],
            id: "second",
            title: "Second workshop",
            startAt: "2026-12-01T10:30:00.000Z",
            endAt: "2026-12-01T11:00:00.000Z",
          },
        ],
      });
      const reviews: ReturnType<typeof agendaScheduleProposalSchema.parse>[] = [];
      const commands: ReturnType<typeof agendaScheduleApplySchema.parse>[] = [];
      let refusing = true;
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
          const path = new URL(String(input), "https://example.test").pathname;
          if (path.endsWith("/schedule/reviews")) {
            const request = agendaScheduleProposalSchema.parse(JSON.parse(String(init?.body)));
            reviews.push(request);
            if (refusing)
              return new Response(
                JSON.stringify({ error: { code: "CONFLICT", message: "Another organizer changed the agenda." } }),
                { status: 409, headers: { "content-type": "application/json" } },
              );
            return json(
              agendaScheduleReviewSchema.parse({
                expectedRevision: data.revision,
                reviewHash: "a".repeat(64),
                affected: request.changes.map((change) => ({
                  before: data.occurrences.find((row) => row.id === change.id),
                  after: { ...data.occurrences.find((row) => row.id === change.id), ...change },
                  beforeOrder: 1,
                  afterOrder: 1,
                })),
              }),
            );
          }
          if (path.endsWith("/schedule")) {
            const request = agendaScheduleApplySchema.parse(JSON.parse(String(init?.body)));
            commands.push(request);
            return json(
              agendaSnapshotSchema.parse({
                ...data,
                revision: 8,
                occurrences: data.occurrences.map((row) => ({
                  ...row,
                  ...request.changes.find((change) => change.id === row.id),
                })),
              }),
            );
          }
          return path.endsWith("/agenda") ? json(data) : reads(input);
        }),
      );
      await mount();
      const canvas = host!.querySelector(".pk-agenda-editor__canvas")!;
      await runRowAction(
        host!,
        "Canonical workshop",
        action === "move" ? "Move to day / location" : action === "swap" ? "Swap sessions" : "Change locations…",
      );
      await settle();
      const dialog = [...host!.querySelectorAll<HTMLDialogElement>("dialog")].find((element) =>
        element
          .querySelector("h2")
          ?.textContent?.startsWith(action === "move" ? "Move " : action === "swap" ? "Swap " : "Locations for "),
      )!;
      await act(() => {
        if (action === "move") {
          const input = dialog.querySelector<HTMLInputElement>('[name="changes.0.startAt"]')!;
          input.value = "2026-12-01T12:00";
          input.dispatchEvent(new Event("input", { bubbles: true }));
        } else if (action === "swap") {
          const select = dialog.querySelector<HTMLSelectElement>('[name="secondId"]')!;
          for (const option of select.options) option.selected = option.value === "second";
          select.dispatchEvent(new Event("change", { bubbles: true }));
        }
      });
      if (action === "locations") {
        const rooms = [...dialog.querySelectorAll<HTMLInputElement>('input[type="checkbox"][value]')].filter(
          (box) => box.value,
        );
        const wanted = ["second-room", "third-room"];
        for (const box of rooms.filter((item) => wanted.includes(item.value) && !item.checked))
          await act(() => box.click());
        for (const box of rooms.filter((item) => !wanted.includes(item.value) && item.checked))
          await act(() => box.click());
      }
      const submit = async () => {
        await act(async () =>
          [...dialog.querySelectorAll<HTMLButtonElement>("button")]
            .find(
              (button) =>
                button.textContent ===
                (action === "move" ? "Move session" : action === "swap" ? "Swap sessions" : "Save locations"),
            )!
            .click(),
        );
        await settle();
      };
      await submit();
      await vi.waitFor(() => expect(reviews).toHaveLength(1));
      expect(dialog.textContent).toContain("Another organizer changed the agenda.");
      expect(dialog.isConnected).toBe(true);
      expect(canvas.isConnected).toBe(true);
      expect(commands).toHaveLength(0);
      expect(reviews[0].expectedRevision).toBe(7);
      if (action === "locations")
        expect(reviews[0].changes).toEqual([
          {
            id: "session",
            startAt: "2026-12-01T10:00:00.000Z",
            endAt: "2026-12-01T10:30:00.000Z",
            roomId: "second-room",
            additionalRoomIds: ["third-room"],
          },
        ]);
      else if (action === "move")
        expect(reviews[0].changes[0]).toMatchObject({
          id: "session",
          startAt: "2026-12-01T11:00:00.000Z",
          endAt: "2026-12-01T11:30:00.000Z",
          roomId: "room",
        });
      else
        expect(reviews[0].changes.map((change) => [change.id, change.startAt, change.endAt])).toEqual([
          ["session", "2026-12-01T10:30:00.000Z", "2026-12-01T11:00:00.000Z"],
          ["second", "2026-12-01T10:00:00.000Z", "2026-12-01T10:30:00.000Z"],
        ]);
      refusing = false;
      await submit();
      await vi.waitFor(() => expect(commands).toHaveLength(1));
      expect(commands[0]).toEqual({ ...reviews[0], reviewHash: "a".repeat(64) });
      expect(dialog.isConnected).toBe(false);
      expect(canvas.isConnected).toBe(true);
    },
  );

  it("closes the current detail before invoking its existing action controller", () => {
    const order: string[] = [];
    const noop = () => {};
    const actions = agendaSessionActions(
      snapshot.occurrences[0],
      {
        canEdit: true,
        canReviewAppearances: false,
        busy: false,
        scheduling: { actions: () => [], timeStep: 5, move: noop, resize: noop },
        open: {
          duplicate: noop,
          history: noop,
          promotion: noop,
          participation: noop,
          move: () => {
            order.push("move");
          },
          swap: noop,
          edit: noop,
        },
        select: noop,
      },
      () => {
        order.push("close");
      },
    );
    actions.find((action) => action.id === "move")!.onSelect?.();
    expect(order).toEqual(["close", "move"]);
  });
  it("offers calendar selection commands only while calendar editing is enabled", () => {
    const noop = () => {};
    const context = {
      canEdit: true,
      canReviewAppearances: false,
      busy: false,
      scheduling: { actions: () => [], timeStep: 5, move: noop, resize: noop },
      open: {
        duplicate: noop,
        history: noop,
        promotion: noop,
        participation: noop,
        move: noop,
        swap: noop,
        edit: noop,
      },
      select: noop,
    };
    const selection = (selectionLocked: boolean) =>
      agendaSessionActions(snapshot.occurrences[0], { ...context, selectionLocked })
        .filter((action) => action.id === "select" || action.id === "resize")
        .map((action) => [action.id, Boolean(action.disabled)]);
    expect(selection(true)).toEqual([
      ["select", true],
      ["resize", true],
    ]);
    expect(selection(false)).toEqual([
      ["select", false],
      ["resize", !snapshot.occurrences[0].startAt],
    ]);
  });
  it("uses the same card and detail commands and closes details before opening the existing move view", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => reads(input)),
    );
    await mount();
    const card = host!.querySelector<HTMLElement>('article[data-agenda-occurrence="session"]')!;
    const cardCommands = commands(await openCardMenu(card, snapshot.occurrences[0].title));
    await act(() => card.querySelector<HTMLButtonElement>('[aria-label="Actions for Canonical workshop"]')!.click());
    const dialog = await openDetail();
    const detailItems = await openCardMenu(dialog, snapshot.occurrences[0].title);
    expect(commands(detailItems)).toEqual(cardCommands);
    const move = detailItems.find((item) => item.textContent === "Move to day / location")!;
    await act(() => move.click());
    await settle();
    expect(dialog.close).toHaveBeenCalledOnce();
    expect(dialog.open).toBe(false);
    expect(host!.textContent).toContain("Move Canonical workshop");
    expect(host!.querySelectorAll("form")).toHaveLength(1);
    const moveDialog = host!.querySelector<HTMLDialogElement>("dialog[open]")!;
    expect(moveDialog.querySelector("h2")?.textContent).toBe("Move Canonical workshop");
    expect(host!.querySelector(".pk-agenda-editor__canvas")).not.toBeNull();
  });

  it("keeps unsaved editor changes until save or explicit cancel and restores actions when values return", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => reads(input));
    const expectReadOnly = () => {
      for (const [, init] of fetcher.mock.calls) {
        expect(init?.method ?? "GET").toBe("GET");
        expect(init?.body ?? null).toBeNull();
      }
    };
    vi.stubGlobal("fetch", fetcher);
    await mount();
    const dialog = await openDetail();
    await runRowAction(dialog, snapshot.occurrences[0].title, "Edit session");
    await vi.waitFor(() => expect(host!.querySelector('[name="title"]')).not.toBeNull());
    expect(dialog.close).toHaveBeenCalledOnce();
    const editor = host!.querySelector<HTMLDialogElement>("dialog[open]")!;
    expect(editor.querySelector("h2")?.textContent).toBe("Edit session");
    const canvas = host!.querySelector(".pk-agenda-editor__canvas")!;
    await inputTitle("Unsaved workshop draft");
    await act(() => {
      [...editor.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
        .find((button) => button.textContent === "Publishing")!
        .click();
    });
    expect(editor.querySelector<HTMLInputElement>('[name="title"]')?.value).toBe("Unsaved workshop draft");
    expectReadOnly();
    expect(editor.querySelectorAll("form")).toHaveLength(1);
    await inputTitle(snapshot.occurrences[0].title);
    expect(editor.querySelector<HTMLInputElement>('[name="title"]')?.value).toBe(snapshot.occurrences[0].title);
    await inputTitle("Explicitly cancelled draft");
    await act(() => {
      [...editor.querySelectorAll<HTMLButtonElement>("button")]
        .find((button) => button.textContent === "Cancel")!
        .click();
    });
    await settle();
    expect(editor.isConnected).toBe(false);
    expect(canvas.isConnected).toBe(true);
    expectReadOnly();
    await runRowAction(canvas, snapshot.occurrences[0].title, "Edit session");
    await vi.waitFor(() => expect(host!.querySelector('[name="title"]')).not.toBeNull());
    expect(host!.querySelector<HTMLInputElement>('[name="title"]')?.value).toBe(snapshot.occurrences[0].title);
    const restored = host!.querySelector<HTMLDialogElement>("dialog[open]")!;
    await act(() =>
      [...restored.querySelectorAll<HTMLButtonElement>("button")]
        .find((button) => button.textContent === "Cancel")!
        .click(),
    );
    const available = await openCardMenu(canvas, snapshot.occurrences[0].title);
    expect(available.find((item) => item.textContent === "Move to day / location")?.disabled).toBe(false);
    expectReadOnly();
  });

  it("disables editor actions during a real contract-validated save", async () => {
    let finish: ((response: Response) => void) | undefined;
    const bodies: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "PATCH") {
          bodies.push(agendaOccurrencePatchSchema.parse(JSON.parse(String(init.body))));
          return new Promise<Response>((resolve) => {
            finish = resolve;
          });
        }
        return reads(input);
      }),
    );
    await mount();
    await runRowAction(
      host!.querySelector('article[data-agenda-occurrence="session"]')!,
      snapshot.occurrences[0].title,
      "Edit session",
    );
    await vi.waitFor(() => expect(host!.querySelector('[name="title"]')).not.toBeNull());
    const editor = host!.querySelector<HTMLDialogElement>("dialog[open]")!;
    await act(() => {
      editor.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await settle();
    expect(bodies).toHaveLength(1);
    expect(editor.querySelector<HTMLFieldSetElement>("fieldset")?.disabled).toBe(true);
    const saving = [...editor.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "Saving…",
    )!;
    expect(saving.disabled).toBe(true);
    await act(() => {
      [...editor.querySelectorAll<HTMLButtonElement>("button")]
        .find((button) => button.textContent === "Cancel")!
        .click();
    });
    expect(editor.isConnected).toBe(true);
    expect(host!.querySelector<HTMLInputElement>('[name="title"]')?.value).toBe(snapshot.occurrences[0].title);
    await act(() => finish!(json(snapshot)));
    await settle();
    expect(host!.querySelector("form")).toBeNull();
  });

  it.each([
    { review: false, expected: [] },
    { review: true, expected: ["Review historical representation"] },
  ])("keeps nonediting detail permissions when appearance review is $review", async ({ review, expected }) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => reads(input)),
    );
    await mount(false, review);
    const dialog = await openDetail();
    if (review)
      expect((await openCardMenu(dialog, snapshot.occurrences[0].title)).map((item) => item.textContent)).toEqual(
        expected,
      );
    else expect(dialog.querySelector(".pk-row-actions button")).toBeNull();
    expect(dialog.querySelector("form")).toBeNull();
  });
});
