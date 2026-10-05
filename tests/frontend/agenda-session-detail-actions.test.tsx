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
  blocks: [],
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
    expect(host!.querySelector("dialog[open]")).toBeNull();
  });

  it("keeps unsaved editor changes until save or explicit cancel and restores actions when values return", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => reads(input));
    vi.stubGlobal("fetch", fetcher);
    await mount();
    const dialog = await openDetail();
    await runRowAction(dialog, snapshot.occurrences[0].title, "Edit / move session");
    await vi.waitFor(() => expect(host!.querySelector('[name="title"]')).not.toBeNull());
    expect(dialog.close).toHaveBeenCalledOnce();
    const pristine = commands(await openCardMenu(host!, snapshot.occurrences[0].title));
    await act(() => host!.querySelector<HTMLButtonElement>('[aria-label="Actions for Canonical workshop"]')!.click());
    await inputTitle("Unsaved workshop draft");
    const dirtyItems = await openCardMenu(host!, snapshot.occurrences[0].title);
    expect(dirtyItems.length).toBeGreaterThan(0);
    expect(dirtyItems.every((item) => item.disabled)).toBe(true);
    expect(host!.textContent).toContain("Save or cancel your changes before using session actions.");
    const calls = fetcher.mock.calls.length;
    await act(() => dirtyItems.find((item) => item.textContent === "Move to day / location")!.click());
    await settle();
    expect(fetcher).toHaveBeenCalledTimes(calls);
    expect(host!.querySelector<HTMLInputElement>('[name="title"]')?.value).toBe("Unsaved workshop draft");
    expect(host!.querySelectorAll("form")).toHaveLength(1);
    await inputTitle(snapshot.occurrences[0].title);
    expect(host!.textContent).not.toContain("Save or cancel your changes before using session actions.");
    const restored = [...host!.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
    expect(commands(restored)).toEqual(pristine);
    await act(() => restored.find((item) => item.textContent === "Move to day / location")!.click());
    await settle();
    expect(host!.textContent).toContain("Move Canonical workshop");
    expect(host!.querySelectorAll("form")).toHaveLength(1);
    expect(host!.querySelector<HTMLInputElement>('[name="title"]')).toBeNull();
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
      "Edit / move session",
    );
    await vi.waitFor(() => expect(host!.querySelector('[name="title"]')).not.toBeNull());
    await act(() => host!.querySelector<HTMLButtonElement>('button[type="submit"]')!.click());
    await settle();
    expect(bodies).toHaveLength(1);
    const items = await openCardMenu(host!, snapshot.occurrences[0].title);
    expect(items.every((item) => item.disabled)).toBe(true);
    expect(host!.textContent).toContain("Saving…");
    await act(() => items.find((item) => item.textContent === "Move to day / location")!.click());
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
