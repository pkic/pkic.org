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

export function initLocalTime() {
  document.querySelectorAll("time[data-local-time]").forEach((el) => {
    const value = el.getAttribute("data-local-time");
    const format = el.getAttribute("data-local-time-format");
    if (!value || !isLocalTimeFormat(format)) return;
    el.textContent = formatLocalTime(value, format, el.getAttribute("data-local-time-until"));
    const container = el.closest("[data-local-time-container]");
    if (container) {
      container.hidden = container.dataset.eventTimeZone === Intl.DateTimeFormat().resolvedOptions().timeZone;
    }
  });
}
