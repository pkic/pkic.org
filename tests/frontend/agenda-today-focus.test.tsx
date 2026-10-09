// @vitest-environment jsdom
import { render } from "preact-render-to-string";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ContentAgenda } from "../../assets/ts/site/ContentAgenda";
import { initializeContentAgenda, openContentAgendaOccurrence } from "../../assets/ts/site/agenda";
import type { ContentAgendaDay } from "../../assets/shared/site-agenda";

type Session = ContentAgendaDay["slots"][number]["sessions"][number];
const session = (id: string, room: string, endsAt: string): Session => ({
  id,
  title: `Session ${id}`,
  kind: "session",
  locations: [room],
  speakers: [],
  descriptionHtml: "<p>Details</p>",
  endsAt,
});
// Amsterdam is UTC+1 in December, so 08:00Z is 09:00 event time.
const days: ContentAgendaDay[] = [
  {
    date: "2026-12-01",
    locations: [{ id: "blue", label: "Blue" }],
    slots: [
      {
        startsAt: "2026-12-01T08:00:00.000Z",
        time: "09:00",
        sessions: [session("first-day", "blue", "2026-12-01T08:45:00.000Z")],
      },
    ],
  },
  {
    date: "2026-12-02",
    locations: [
      { id: "blue", label: "Blue" },
      { id: "green", label: "Green" },
    ],
    slots: [
      {
        startsAt: "2026-12-02T08:00:00.000Z",
        time: "09:00",
        sessions: [session("a", "blue", "2026-12-02T08:45:00.000Z")],
      },
      { startsAt: "2026-12-02T08:45:00.000Z", time: "09:45", title: "Coffee", durationMinutes: 15, sessions: [] },
      {
        startsAt: "2026-12-02T09:00:00.000Z",
        time: "10:00",
        sessions: [session("b", "blue", "2026-12-02T09:45:00.000Z"), session("c", "green", "2026-12-02T09:45:00.000Z")],
      },
      {
        startsAt: "2026-12-02T10:00:00.000Z",
        time: "11:00",
        sessions: [session("d", "blue", "2026-12-02T10:45:00.000Z")],
      },
      {
        startsAt: "2026-12-02T11:00:00.000Z",
        time: "12:00",
        sessions: [session("e", "blue", "2026-12-02T11:45:00.000Z")],
      },
    ],
  },
];

let host: HTMLElement;
let dispose: (() => void) | undefined;
let scrollTo: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe = vi.fn();
      disconnect = vi.fn();
    },
  );
  vi.stubGlobal(
    "CSSStyleSheet",
    class {
      replaceSync = vi.fn();
    },
  );
  vi.stubGlobal("CSS", { escape: (value: string) => value });
  document.adoptedStyleSheets = [];
  scrollTo = vi.fn();
  vi.stubGlobal("scrollTo", scrollTo);
  vi.stubGlobal("scrollBy", vi.fn());
  host = document.createElement("div");
  document.body.append(host);
});
afterEach(() => {
  dispose?.();
  dispose = undefined;
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function phone(matches: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches })),
  );
}
function mount(now: string, props: Partial<Parameters<typeof ContentAgenda>[0]> = {}) {
  vi.useFakeTimers({
    now: new Date(now),
    toFake: ["Date", "setInterval", "clearInterval", "requestAnimationFrame", "cancelAnimationFrame"],
  });
  host.innerHTML = render(<ContentAgenda days={days} speakers={[]} timeZone="Europe/Amsterdam" {...props} />);
  const root = host.querySelector<HTMLElement>(".pk-content-agenda")!;
  dispose = initializeContentAgenda(root);
  return root;
}
const selectedTab = (root: HTMLElement) =>
  root.querySelector('[data-agenda-tab][aria-selected="true"]')?.getAttribute("data-agenda-tab");
const finishedTimes = (root: HTMLElement) =>
  [...root.querySelectorAll<HTMLElement>(".pk-content-agenda__slot[data-agenda-finished]")].map(
    (row) => row.querySelector('[data-agenda-clock="venue"] time')?.textContent,
  );
const disclosure = (root: HTMLElement, date: string) =>
  root.querySelector<HTMLElement>(`[data-agenda-panel="${date}"] [data-agenda-earlier]`)!;

it("opens today's day on a phone, folds finished slots behind Earlier today and scrolls to the live slot", () => {
  phone(true);
  const root = mount("2026-12-02T10:40:00.000Z");
  expect(selectedTab(root)).toBe("2026-12-02");
  expect(root.querySelector<HTMLElement>('[data-agenda-panel="2026-12-02"]')!.hidden).toBe(false);
  // The coffee break and both parallel sessions have ended; 11:00 is live.
  expect(finishedTimes(root)).toEqual(["09:00", "09:45", "10:00"]);
  const earlier = disclosure(root, "2026-12-02");
  expect(earlier.hidden).toBe(false);
  expect(earlier.textContent).toBe("Earlier today · 3 sessions");
  expect(disclosure(root, "2026-12-01").hidden).toBe(true);
  expect(scrollTo).not.toHaveBeenCalled();
  vi.advanceTimersToNextFrame();
  // matchMedia reports reduced motion here too, so the jump is instant.
  expect(scrollTo).toHaveBeenCalledTimes(1);
  expect(scrollTo.mock.calls[0]![0]).toMatchObject({ behavior: "instant" });

  const toggle = earlier.querySelector<HTMLButtonElement>("[data-agenda-earlier-toggle]")!;
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  toggle.click();
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  expect(root.querySelector('[data-agenda-panel="2026-12-02"]')!.hasAttribute("data-agenda-earlier-open")).toBe(true);
  toggle.click();
  expect(root.querySelector('[data-agenda-panel="2026-12-02"]')!.hasAttribute("data-agenda-earlier-open")).toBe(false);

  // Later updates follow the clock without another scroll to the live slot.
  vi.advanceTimersByTime(30 * 60_000);
  expect(finishedTimes(root)).toEqual(["09:00", "09:45", "10:00", "11:00"]);
  expect(earlier.textContent).toBe("Earlier today · 4 sessions");
  expect(scrollTo).toHaveBeenCalledTimes(1);
});

it("scrolls past an all-day item that is still running to the slot holding now", () => {
  phone(true);
  const withRegistration = structuredClone(days);
  withRegistration[1]!.slots.unshift({
    startsAt: "2026-12-02T07:00:00.000Z",
    time: "08:00",
    sessions: [session("registration", "green", "2026-12-02T16:00:00.000Z")],
  });
  const root = mount("2026-12-02T10:40:00.000Z", { days: withRegistration });
  // Registration has not finished, so it stays unfolded above the folded 09:00–10:00 slots.
  expect(finishedTimes(root)).toEqual(["09:00", "09:45", "10:00"]);
  const rows = [...root.querySelectorAll<HTMLElement>('[data-agenda-panel="2026-12-02"] .pk-content-agenda__slot')];
  rows.forEach((row, index) =>
    Object.defineProperty(row, "getBoundingClientRect", {
      value: () => ({ top: index * 100, bottom: index * 100 + 90 }),
    }),
  );
  const live = rows.findIndex((row) => row.querySelector('[data-agenda-clock="venue"] time')?.textContent === "11:00");
  expect(live).toBeGreaterThan(0);
  vi.advanceTimersToNextFrame();
  // The site bar's fallback height (57px) and an 8px gap stay above the live slot.
  expect(scrollTo).toHaveBeenCalledWith({ top: live * 100 - 65, behavior: "instant" });
});

it("keeps the whole agenda before and after the event and when the day has completely finished", () => {
  phone(true);
  let root = mount("2026-11-30T10:00:00.000Z");
  expect(selectedTab(root)).toBe("2026-12-01");
  expect(finishedTimes(root)).toEqual([]);
  expect([...root.querySelectorAll<HTMLElement>("[data-agenda-earlier]")].every((item) => item.hidden)).toBe(true);
  vi.advanceTimersToNextFrame();
  expect(scrollTo).not.toHaveBeenCalled();
  dispose!();
  vi.useRealTimers();

  root = mount("2026-12-03T10:00:00.000Z");
  expect(selectedTab(root)).toBe("2026-12-01");
  expect(finishedTimes(root)).toEqual([]);
  dispose!();
  vi.useRealTimers();

  root = mount("2026-12-02T20:00:00.000Z");
  expect(selectedTab(root)).toBe("2026-12-02");
  expect(finishedTimes(root)).toEqual([]);
  vi.advanceTimersToNextFrame();
  expect(scrollTo).not.toHaveBeenCalled();
});

it("selects today without scrolling on a desktop page outside the event app", () => {
  phone(false);
  const root = mount("2026-12-02T10:40:00.000Z");
  expect(selectedTab(root)).toBe("2026-12-02");
  expect(finishedTimes(root)).toHaveLength(3);
  vi.advanceTimersToNextFrame();
  expect(scrollTo).not.toHaveBeenCalled();
});

it("lets a deep link choose its day and reveals a folded slot before opening its details", () => {
  phone(true);
  let root = mount("2026-12-02T10:40:00.000Z", { openOccurrence: "first-day" });
  expect(root.hasAttribute("data-agenda-today-focus")).toBe(false);
  expect(selectedTab(root)).toBe("2026-12-01");
  expect(finishedTimes(root)).toEqual([]);
  dispose!();
  vi.useRealTimers();

  root = mount("2026-12-02T10:40:00.000Z");
  const card = root.querySelector<HTMLElement>('[data-agenda-occurrence="b"]')!;
  const dialog = host.querySelector<HTMLDialogElement>(`#${card.dataset.agendaSessionDialog}`)!;
  Object.defineProperty(dialog, "showModal", {
    value: () => {
      dialog.open = true;
    },
  });
  expect(card.closest("[data-agenda-finished]")).not.toBeNull();
  expect(openContentAgendaOccurrence(root, "b")).toBe(true);
  expect(dialog.open).toBe(true);
  const panel = root.querySelector('[data-agenda-panel="2026-12-02"]')!;
  expect(panel.hasAttribute("data-agenda-earlier-open")).toBe(true);
  expect(panel.querySelector("[data-agenda-earlier-toggle]")?.getAttribute("aria-expanded")).toBe("true");
  dialog.open = false;
  document.body.classList.remove("agenda-modal-open");
});

it("leaves the organizer editor's rows and toolbar unchanged on an event day", () => {
  phone(true);
  const root = mount("2026-12-02T10:40:00.000Z", {
    editor: { session: () => ({ controls: null }), dropTarget: () => null },
  });
  expect(root.hasAttribute("data-agenda-today-focus")).toBe(false);
  expect(root.querySelector("[data-agenda-earlier]")).toBeNull();
  expect(finishedTimes(root)).toEqual([]);
  expect(root.dataset.agendaFilters).toBeUndefined();
  vi.advanceTimersToNextFrame();
  expect(scrollTo).not.toHaveBeenCalled();
});
