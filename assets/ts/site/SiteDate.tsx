import { formatLocalTime, type LocalTimeFormat } from "../../shared/format-date";

/**
 * A date on a server-rendered page, read in the visitor's own locale and zone.
 *
 * The Worker cannot know either, so the element carries the value and the
 * format and `local-time.js` writes the reader's rendering over the fallback.
 * Both readings come from `formatLocalTime`, the site's one date policy.
 */
export function LocalTime({
  class: className,
  format = "date",
  until,
  value,
}: {
  class?: string;
  format?: LocalTimeFormat;
  /** The last day of a span, for a `date` that covers more than one day. */
  until?: string;
  value: string;
}) {
  return (
    <time
      class={className}
      dateTime={value}
      data-local-time={value}
      data-local-time-format={format}
      data-local-time-until={until}
    >
      {formatLocalTime(value, format, until)}
    </time>
  );
}

const DAY_MILLISECONDS = 86_400_000;

/**
 * When an event happens: its start instant with the reader's zone named for a
 * single-day event, the span of days for a longer one.
 */
export function EventTime({
  class: className,
  duration = 1,
  value,
}: {
  class?: string;
  duration?: number;
  value: string;
}) {
  const start = Date.parse(value);
  if (duration <= 1 || Number.isNaN(start)) return <LocalTime class={className} format="date-time" value={value} />;
  const until = new Date(start + (duration - 1) * DAY_MILLISECONDS).toISOString();
  return <LocalTime class={className} until={until} value={value} />;
}

export function CalendarIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </svg>
  );
}
