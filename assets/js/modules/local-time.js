/**
 * local-time.js
 * Finds every <time data-local-time="ISO-string"> element and replaces its
 * text content with a human-readable date/time in the visitor's local timezone.
 *
 * Markup produced by Hugo templates:
 *   <time data-local-time="2026-03-19T16:00:00Z">19 Mar 2026, 16:00 UTC</time>
 *   <time data-local-time="2026-03-19T16:00:00Z" data-local-time-date-only>19 Mar 2026</time>
 */
import { formatDate, formatDateTime } from '../../shared/format-date';

export function initLocalTime() {
  const els = document.querySelectorAll('time[data-local-time]');
  if (!els.length) return;

  els.forEach((el) => {
    const iso = el.getAttribute('data-local-time');
    if (!iso) return;

    const d = new Date(iso);
    if (isNaN(d)) return;

    const dateOnly = el.hasAttribute('data-local-time-date-only');

    // The shared browser-locale rendering (issue #10); date-times name the
    // viewer's zone so the converted-to-local time cannot be mistaken for UTC.
    el.textContent = dateOnly ? formatDate(iso) : formatDateTime(iso, { zoneName: true });
  });
}
