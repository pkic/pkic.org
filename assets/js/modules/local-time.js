/**
 * local-time.js
 * Finds every <time data-local-time="ISO-string"> element and replaces its
 * text content with a human-readable date/time in the visitor's local timezone.
 *
 * Markup produced by Hugo templates:
 *   <time data-local-time="2026-03-19T16:00:00Z">19 Mar 2026, 16:00 UTC</time>
 *   <time data-local-time="2026-03-19T16:00:00Z" data-local-time-date-only>19 Mar 2026</time>
 */
export function initLocalTime() {
  const els = document.querySelectorAll('time[data-local-time]');
  if (!els.length) return;

  els.forEach((el) => {
    const iso = el.getAttribute('data-local-time');
    if (!iso) return;

    const d = new Date(iso);
    if (isNaN(d)) return;

    const dateOnly = el.hasAttribute('data-local-time-date-only');

    if (dateOnly) {
      el.textContent = new Intl.DateTimeFormat(undefined, {
        day: 'numeric', month: 'short', year: 'numeric',
      }).format(d);
    } else {
      const formatted = new Intl.DateTimeFormat(undefined, {
        day: 'numeric', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
        timeZoneName: 'short',
      }).format(d);
      el.textContent = formatted;
    }
  });
}
