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
import { agendaLocalClock } from "../../shared/agenda-time-display";

const agendaTimeChoices = new WeakMap();

function renderAgendaClocks(root) {
  const eventZone = root.dataset.agendaTimeZone;
  const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const choice = root.querySelector("[data-agenda-time-select]");
  if (!eventZone || !choice) return;
  const distinct = eventZone !== browserZone;
  root.querySelector("[data-agenda-time-choice]").hidden = !distinct;
  root.dataset.agendaTimeDisplay = distinct && choice.value === "browser" ? "browser" : "venue";
  choice.querySelector('[value="browser"]').textContent = `Your time · ${browserZone}`;
  for (const clock of root.querySelectorAll('[data-agenda-clock="browser"]')) {
    const element = clock.querySelector("time[data-local-time]");
    const value = element?.dataset.localTime;
    if (!value) continue;
    const local = agendaLocalClock(value, eventZone, browserZone);
    element.textContent = local.time;
    clock.querySelector("[data-agenda-browser-zone]").textContent = `Your time · ${browserZone}`;
    const date = clock.querySelector("[data-agenda-local-date]");
    date.textContent = local.date ?? "";
    date.hidden = !local.date;
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
    const select = root.querySelector("[data-agenda-time-select]");
    if (!select) continue;
    let dispose = agendaTimeChoices.get(root);
    if (!dispose) {
      const change = () => renderAgendaClocks(root);
      select.addEventListener("change", change);
      dispose = () => {
        select.removeEventListener("change", change);
        agendaTimeChoices.delete(root);
      };
      agendaTimeChoices.set(root, dispose);
    }
    cleanup.push(dispose);
  }
  return () => cleanup.forEach((dispose) => dispose());
}
