/**
 * local-time.js
 * Rewrites every <time data-local-time="ISO-string"> element in the visitor's
 * own locale and zone, through the same `formatLocalTime` the server used for
 * the element's fallback text.
 *
 *   <time data-local-time="2026-03-19T16:00:00Z" data-local-time-format="date-time">…</time>
 *   <time data-local-time="2026-03-19" data-local-time-format="date">…</time>
 *   <time data-local-time="2026-12-01" data-local-time-until="2026-12-03" data-local-time-format="date">…</time>
 *   <time data-local-time="2026-12-01" data-local-time-format="weekday">…</time>
 */
import { formatLocalTime, isLocalTimeFormat } from "../../shared/format-date";
import { agendaLocalClock, agendaZoneAbbreviation, agendaZoneCity } from "../../shared/agenda-time-display";

const agendaTimeChoices = new WeakMap();

const AGENDA_TIME_CHOICE_KEY = "pkic-agenda-time-zone";

function storedAgendaTimeChoice() {
  try {
    return localStorage.getItem(AGENDA_TIME_CHOICE_KEY);
  } catch {
    return null;
  }
}

function isTimeZone(zone) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/**
 * "venue" shows event time (with the device time beside it when they differ),
 * "browser" leads with the device zone and any other value is a chosen IANA zone.
 */
function renderAgendaClocks(root) {
  const eventZone = root.dataset.agendaTimeZone;
  const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (!eventZone) return;
  const requested = root.dataset.agendaTimeChoice ?? storedAgendaTimeChoice() ?? "venue";
  const selection = requested === "venue" || requested === "browser" || isTimeZone(requested) ? requested : "venue";
  const alternateZone = selection === "venue" ? browserZone : selection === "browser" ? browserZone : selection;
  const distinct = alternateZone !== eventZone;
  root.dataset.agendaTimeChoice = selection;
  root.dataset.agendaDistinctZones = String(distinct);
  root.dataset.agendaTimeDisplay = selection !== "venue" && distinct ? "browser" : "venue";
  for (const timeChoice of root.querySelectorAll("[data-agenda-time-choice]")) timeChoice.hidden = false;
  for (const choice of root.querySelectorAll("[data-agenda-time-select]")) {
    const browserOption = choice.querySelector('[value="browser"]');
    browserOption.textContent = `${agendaZoneCity(browserZone)} — your device`;
    browserOption.title = browserZone;
    browserOption.dataset.agendaZoneCity = agendaZoneCity(browserZone);
    if (![...choice.options].some((option) => option.value === selection)) {
      const option = new Option(agendaZoneCity(selection), selection);
      option.title = selection;
      option.dataset.agendaZoneCity = agendaZoneCity(selection);
      choice.add(option);
    }
    choice.value = selection;
    choice.title = selection === "venue" ? eventZone : alternateZone;
  }
  for (const face of root.querySelectorAll("[data-agenda-time-face]")) {
    face.textContent = agendaZoneCity(selection === "venue" ? eventZone : alternateZone);
  }
  for (const label of root.querySelectorAll("[data-agenda-time-mode]")) {
    label.textContent =
      root.dataset.agendaTimeDisplay === "venue"
        ? distinct
          ? "Event time"
          : "Time"
        : selection === "browser"
          ? "Your time"
          : "Time zone";
  }
  for (const label of root.querySelectorAll("[data-agenda-browser-zone]")) {
    label.textContent = `${selection === "venue" || selection === "browser" ? "Your time" : "Shown in"} · ${agendaZoneCity(alternateZone)}`;
    label.title = alternateZone;
    label.hidden = !distinct;
  }
  for (const clock of root.querySelectorAll('[data-agenda-clock="browser"]')) {
    const element = clock.querySelector("time[data-local-time]");
    const value = element?.dataset.localTime;
    if (!value) continue;
    const local = agendaLocalClock(value, eventZone, alternateZone);
    element.textContent = local.time;
    const date = clock.querySelector("[data-agenda-local-date]");
    date.textContent = local.date ?? "";
    date.hidden = !local.date;
    const zone = clock.querySelector("[data-agenda-zone-abbr]");
    if (zone) zone.textContent = agendaZoneAbbreviation(value, alternateZone);
    clock.hidden = !distinct;
  }
}

/** @param {Document | HTMLElement} [scope] */
export function initLocalTime(scope = document) {
  scope.querySelectorAll("time[data-local-time]").forEach((el) => {
    const value = el.getAttribute("data-local-time");
    const format = el.getAttribute("data-local-time-format");
    if (!value || !isLocalTimeFormat(format)) return;
    el.textContent = formatLocalTime(value, format, el.getAttribute("data-local-time-until"));
    const container = el.closest("[data-local-time-container]");
    if (container) {
      container.hidden = container.dataset.eventTimeZone === Intl.DateTimeFormat().resolvedOptions().timeZone;
    }
  });
  const agendas =
    "matches" in scope && scope.matches("[data-agenda-time-zone]")
      ? [scope]
      : [...scope.querySelectorAll("[data-agenda-time-zone]")];
  const cleanup = [];
  for (const root of agendas) {
    renderAgendaClocks(root);
    if (!root.querySelector("[data-agenda-time-select]")) continue;
    let dispose = agendaTimeChoices.get(root);
    if (!dispose) {
      const change = (event) => {
        const select = event.target;
        if (!(select instanceof HTMLSelectElement) || !select.matches("[data-agenda-time-select]")) return;
        root.dataset.agendaTimeChoice = select.value;
        try {
          localStorage.setItem(AGENDA_TIME_CHOICE_KEY, select.value);
        } catch {
          /* The choice still applies to this page view. */
        }
        renderAgendaClocks(root);
      };
      root.addEventListener("change", change);
      dispose = () => {
        root.removeEventListener("change", change);
        agendaTimeChoices.delete(root);
      };
      agendaTimeChoices.set(root, dispose);
    }
    cleanup.push(dispose);
  }
  return () => cleanup.forEach((dispose) => dispose());
}
