/*
 * Canonical rendering for every DISPLAYED date on the site.
 *
 * Displayed dates follow the viewer's own browser locale by policy
 * (issue #10): every helper passes `undefined` as the locale, and no caller
 * may pin a literal such as "en-US" — that is exactly the bug this module
 * exists to prevent, because a pinned locale silently shows US month-first
 * ordering to viewers who expect day-first (or vice versa).
 *
 * Zones follow the repository's time rules: instants localize to the
 * viewer's zone at this presentation boundary, an in-person event renders on
 * its own IANA zone with the zone named (`formatDateTimeInZone`,
 * `formatEventWhen`), and date-only values render as calendar dates without
 * any zone shift (`formatCalendarDate`). Stored and transport values are
 * untouched: contracts and `<input type="date">` keep ISO `YYYY-MM-DD` and
 * UTC instants with `Z` (wall-clock conversion lives in `timezone.ts`,
 * not here).
 */

const EMPTY = "—";

/** Anything that is not a parseable instant renders as the empty marker. */
function toDate(value: string): Date | null {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** An instant as a date only (no time of day) in the viewer's own locale, or an em dash. */
export function formatDate(value: string | null | undefined): string {
  if (!value) return EMPTY;
  const date = toDate(value);
  if (!date) return EMPTY;
  return date.toLocaleString(undefined, { dateStyle: "medium" });
}

/**
 * A date-only `YYYY-MM-DD` value in the viewer's locale. Calendar dates are
 * day-precise in the owning entity's zone, so the value is rendered on the
 * UTC calendar rather than through the viewer's zone — parsing it as an
 * instant and localizing would shift the day for viewers west of UTC. A
 * value that is not date-only falls back to `formatDate`.
 */
export function formatCalendarDate(value: string | null | undefined): string {
  if (!value) return EMPTY;
  if (!DATE_ONLY.test(value)) return formatDate(value);
  const date = toDate(`${value}T00:00:00Z`);
  if (!date) return EMPTY;
  return date.toLocaleString(undefined, { dateStyle: "medium", timeZone: "UTC" });
}

/**
 * A month-precise rendering in the viewer's locale — used where only the
 * month matters (leadership terms, membership tenure). Date-only input stays
 * on the UTC calendar so the month cannot shift with the viewer's zone.
 */
export function formatMonthYear(value: string | null | undefined): string {
  if (!value) return EMPTY;
  const dateOnly = DATE_ONLY.test(value);
  const date = toDate(dateOnly ? `${value}T00:00:00Z` : value);
  if (!date) return EMPTY;
  return date.toLocaleString(undefined, {
    month: "short",
    year: "numeric",
    ...(dateOnly ? { timeZone: "UTC" } : {}),
  });
}

/**
 * An instant in the viewer's own locale and zone, or an em dash.
 * `seconds` widens the time for audit trails; `zoneName` names the viewer's
 * zone (used where a page shows a converted-to-local time next to UTC
 * source text, so the reader knows whose clock is shown).
 */
export function formatDateTime(
  value: string | null | undefined,
  options: { seconds?: boolean; zoneName?: boolean } = {},
): string {
  if (!value) return EMPTY;
  const date = toDate(value);
  if (!date) return EMPTY;
  if (options.zoneName) {
    // dateStyle/timeStyle cannot be combined with timeZoneName, so the
    // zone-labeled variant spells out equivalent component options.
    return date.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      ...(options.seconds ? { second: "2-digit" as const } : {}),
      timeZoneName: "short",
    });
  }
  return date.toLocaleString(undefined, {
    dateStyle: "short",
    timeStyle: options.seconds ? "medium" : "short",
  });
}

/**
 * An instant on the wall clock of a specific IANA zone, with the zone named
 * so the reader cannot mistake it for their own — "Dec 1, 2026, 9:00 AM CET"
 * in an en-US browser.
 */
export function formatDateTimeInZone(value: string | null | undefined, timeZone: string): string {
  if (!value) return EMPTY;
  const date = toDate(value);
  if (!date) return EMPTY;
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
    timeZoneName: "short",
  });
}

/**
 * A friendly calendar span in the viewer's locale — "1–3 December 2026" style,
 * collapsing to a single date when the range covers one day. Dates render in
 * the owning event's zone when one is given, per the wall-clock rule.
 */
export function formatDateRange(
  startsAt: string | null | undefined,
  endsAt: string | null | undefined,
  timeZone?: string | null,
): string {
  if (!startsAt) return EMPTY;
  const options: Intl.DateTimeFormatOptions = {
    day: "numeric",
    month: "long",
    year: "numeric",
    ...(timeZone ? { timeZone } : {}),
  };
  const formatter = new Intl.DateTimeFormat(undefined, options);
  const start = new Date(startsAt);
  if (!endsAt) return formatter.format(start);
  try {
    return formatter.formatRange(start, new Date(endsAt));
  } catch {
    return formatter.format(start);
  }
}

/**
 * Display policy for event times. The viewer's own registration is the
 * authoritative signal: attending in person shows the venue's clock with its
 * zone named, attending virtually or on demand shows the viewer's local
 * time. Without a registration, a physical venue implies the venue's clock;
 * everything else (and deadlines) stays local.
 */
export function formatEventWhen(
  startsAt: string | null | undefined,
  timeZone: string | null | undefined,
  location: string | null | undefined,
  attendanceType?: "in_person" | "virtual" | "on_demand" | null,
): string {
  if (attendanceType === "in_person" && timeZone) return formatDateTimeInZone(startsAt, timeZone);
  if (attendanceType) return formatDateTime(startsAt);
  if (location && timeZone) return formatDateTimeInZone(startsAt, timeZone);
  return formatDateTime(startsAt);
}

/** "today", "tomorrow", "in 95 days" — null when the instant is past or unknown. */
export function formatRelativeDays(instant: string | null | undefined): string | null {
  if (!instant) return null;
  const millis = new Date(instant).getTime() - Date.now();
  if (!Number.isFinite(millis)) return null;
  const days = Math.round(millis / 86_400_000);
  if (days < 0) return null;
  return new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }).format(days, "day");
}
