import { formatNumber } from "../../shared/format-number";
import { instantToDateTimeLocal } from "../../shared/timezone";
import { agendaStickyTop } from "./agenda-sticky-top";

const PHONE_QUERY = "(max-width: 47.499rem)";

/** The calendar date in the event's zone, which is what each day panel's `YYYY-MM-DD` means. */
function agendaToday(root: HTMLElement, now: number): string | undefined {
  const zone = root.dataset.agendaTimeZone;
  if (!zone) return undefined;
  try {
    return instantToDateTimeLocal(new Date(now), zone).slice(0, 10);
  } catch {
    return undefined;
  }
}

/** The day tab for today in the event's zone; none before or after the event. */
export function agendaTodayTab(root: HTMLElement, now = Date.now()): HTMLButtonElement | undefined {
  const today = agendaToday(root, now);
  return [...root.querySelectorAll<HTMLButtonElement>("[data-agenda-tab]")].find(
    (tab) => today && tab.dataset.agendaTab === today,
  );
}

function slotStart(row: HTMLElement): number {
  return Date.parse(row.querySelector<HTMLTimeElement>('[data-agenda-clock="venue"] time')?.dateTime ?? "");
}

/**
 * A slot has finished when everything that starts in it (sessions and breaks alike) has ended. A slot's own
 * span runs to the next slot's start; a session or break with a later end extends it, and an unknown end on
 * the last slot of the day keeps that slot open.
 */
function finishedSlots(panel: HTMLElement, now: number): HTMLElement[] {
  const rows = [...panel.querySelectorAll<HTMLElement>(".pk-content-agenda__slot")];
  const starts = rows.map(slotStart);
  const finished = rows.filter((row, index) => {
    const next = starts.slice(index + 1).find((start) => Number.isFinite(start));
    const ends = [...row.querySelectorAll<HTMLElement>("[data-agenda-media-session]")].map((card) =>
      Date.parse(card.dataset.agendaMediaEnd ?? ""),
    );
    const known = ends.filter((end) => Number.isFinite(end));
    if (next === undefined && (!known.length || known.length < ends.length)) return false;
    return Math.max(next ?? -Infinity, ...known) <= now;
  });
  // A day that has completely finished stays whole rather than folding into one empty disclosure.
  return finished.length < rows.length ? finished : [];
}

function sessionCount(rows: readonly HTMLElement[]): number {
  const cards = rows.flatMap((row) => [
    ...row.querySelectorAll<HTMLElement>('[data-agenda-media-session]:not([data-agenda-kind="break"])'),
  ]);
  // A session spanning split room cells renders one card per cell.
  return new Set(cards.map((card, index) => card.dataset.agendaOccurrence || `card-${index}`)).size;
}

function applyEarlierSessions(panel: HTMLElement, finished: ReadonlySet<HTMLElement>): void {
  for (const row of panel.querySelectorAll<HTMLElement>(".pk-content-agenda__slot"))
    row.toggleAttribute("data-agenda-finished", finished.has(row));
  const disclosure = panel.querySelector<HTMLElement>("[data-agenda-earlier]");
  if (!disclosure) return;
  disclosure.hidden = finished.size === 0;
  const count = sessionCount([...finished]);
  const label = disclosure.querySelector<HTMLElement>("[data-agenda-earlier-label]");
  if (label)
    label.textContent = count
      ? `Earlier today · ${formatNumber(count)} ${count === 1 ? "session" : "sessions"}`
      : "Earlier today";
}

/** Show a collapsed earlier slot again before something inside it is opened or scrolled to. */
export function revealAgendaEarlierSessions(element: Element): void {
  if (!element.closest("[data-agenda-finished]")) return;
  const panel = element.closest<HTMLElement>("[data-agenda-panel]");
  panel?.setAttribute("data-agenda-earlier-open", "");
  panel?.querySelector("[data-agenda-earlier-toggle]")?.setAttribute("aria-expanded", "true");
}

function scrollBehavior(): ScrollBehavior {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth";
}

/** The height pinned above the program: site or portal chrome, plus the sticky toolbar and room header above phones. */
function pinnedHeight(root: HTMLElement, panel: HTMLElement): number {
  let height = agendaStickyTop(root);
  if (window.matchMedia(PHONE_QUERY).matches) return height;
  height += root.querySelector<HTMLElement>("[data-agenda-controls]")?.getBoundingClientRect().height ?? 0;
  const header = panel.querySelector<HTMLTableElement>(".pk-content-agenda__timeline")?.tHead;
  if (header && getComputedStyle(header).display !== "none") height += header.getBoundingClientRect().height;
  return height;
}

/**
 * On an event day, finished slots of today's panel fold behind one "Earlier today" disclosure (phone list view
 * only, through CSS), and phones and the event app open at the slot holding now. The state follows
 * the browser clock on the same 30-second cadence as the NOW line, keeping the reader's place on later updates.
 */
export function initializeAgendaEarlierSessions(root: HTMLElement): () => void {
  const events = new AbortController();
  const update = (keepPlace: boolean) => {
    const now = Date.now();
    const today = agendaToday(root, now);
    const panels = [...root.querySelectorAll<HTMLElement>(".pk-content-agenda__day[data-agenda-panel]")];
    const todayPanel = panels.find((panel) => today && panel.dataset.agendaPanel === today);
    const finished = new Set(todayPanel ? finishedSlots(todayPanel, now) : []);
    // Anchor on the first row on screen that stays after this update, so folding rows above it never moves it.
    const visible = keepPlace && todayPanel && !todayPanel.hidden ? todayPanel : undefined;
    const pinned = visible ? pinnedHeight(root, visible) : 0;
    const anchor = [...(visible?.querySelectorAll<HTMLElement>(".pk-content-agenda__slot") ?? [])].find((row) => {
      const bounds = row.getBoundingClientRect();
      return !finished.has(row) && bounds.bottom > pinned && bounds.top < window.innerHeight;
    });
    const before = anchor?.getBoundingClientRect().top;
    for (const panel of panels) applyEarlierSessions(panel, panel === todayPanel ? finished : new Set());
    const shift = anchor && before !== undefined ? anchor.getBoundingClientRect().top - before : 0;
    if (shift) window.scrollBy({ top: shift, behavior: "instant" });
    return { todayPanel, finished };
  };
  const initial = update(false);
  const current = initial.todayPanel;
  let frame = 0;
  const focusNow = window.matchMedia(PHONE_QUERY).matches || Boolean(document.querySelector(".pk-app-tabbar--event"));
  if (current && !current.hidden && initial.finished.size && focusNow) {
    // The slot holding now (the latest one already started), else the first upcoming one. A long unfinished
    // item that began earlier, such as all-day registration, stays unfolded above it but is scrolled past.
    const rows = [...current.querySelectorAll<HTMLElement>(".pk-content-agenda__slot")];
    const now = Date.now();
    const target = [...rows].reverse().find((row) => slotStart(row) <= now) ?? rows.find((row) => slotStart(row) > now);
    // After the first layout pass, so the sticky chrome and folded rows have their final geometry.
    frame = requestAnimationFrame(() => {
      if (!target || current.hidden) return;
      window.scrollTo({
        top: window.scrollY + target.getBoundingClientRect().top - pinnedHeight(root, current) - 8,
        behavior: scrollBehavior(),
      });
    });
  }
  root.addEventListener(
    "click",
    (event) => {
      const toggle = event.target instanceof Element ? event.target.closest("[data-agenda-earlier-toggle]") : null;
      const panel = toggle?.closest<HTMLElement>("[data-agenda-panel]");
      if (!toggle || !panel) return;
      const open = !panel.hasAttribute("data-agenda-earlier-open");
      panel.toggleAttribute("data-agenda-earlier-open", open);
      toggle.setAttribute("aria-expanded", String(open));
    },
    { signal: events.signal },
  );
  const timer = window.setInterval(() => update(true), 30_000);
  return () => {
    cancelAnimationFrame(frame);
    window.clearInterval(timer);
    events.abort();
    for (const panel of root.querySelectorAll<HTMLElement>(".pk-content-agenda__day[data-agenda-panel]")) {
      applyEarlierSessions(panel, new Set());
      panel.removeAttribute("data-agenda-earlier-open");
      panel.querySelector("[data-agenda-earlier-toggle]")?.setAttribute("aria-expanded", "false");
    }
  };
}
