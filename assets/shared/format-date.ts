/*
 * Canonical rendering for every DISPLAYED date on the site.
 *
 * Displayed dates follow the viewer's own browser locale by policy
 * (issue #10, confirmed by the user): every helper passes `undefined` as the
 * locale, and no caller may pin a literal such as "en-US" — that is exactly
 * the bug this module exists to prevent, because a pinned locale silently
 * shows US month-first ordering to viewers who expect day-first (or vice
 * versa). A reader seeing month-first is seeing their own browser locale.
 *
 * `tests/tools/displayed-date-formatting.test.ts` holds both halves of that
 * policy: nothing outside this file formats a date for a reader, and nothing
 * inside it pins a locale.
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

import { formatNumber } from "./format-number";
import { clockTimeZone, type ClockZone } from "./event-clock";

/** What every formatter here writes when there is no date, or none it can read. */
export const EMPTY_DATE = "—";
const EMPTY = EMPTY_DATE;

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
export function formatCalendarDate(
  value: string | null | undefined,
  dateStyle: Intl.DateTimeFormatOptions["dateStyle"] = "medium",
): string {
  if (!value) return EMPTY;
  if (!DATE_ONLY.test(value)) return formatDate(value);
  const date = toDate(`${value}T00:00:00Z`);
  if (!date) return EMPTY;
  return date.toLocaleString(undefined, { dateStyle, timeZone: "UTC" });
}

/**
 * A `YYYY-MM-DD` calendar date as day and month, without the year — used
 * where the year is already established by the surrounding text, such as the
 * days of one event. Day-precise, so it renders on the UTC calendar; an
 * unreadable or absent value is the empty marker rather than "Invalid Date".
 */
export function formatDayAndMonth(value: string | null | undefined): string {
  if (!value) return EMPTY;
  const date = toDate(DATE_ONLY.test(value) ? `${value}T00:00:00Z` : value);
  if (!date) return EMPTY;
  return date.toLocaleString(undefined, { day: "numeric", month: "short", timeZone: "UTC" });
}

/**
 * A `YYYY-MM-DD` calendar date split for a calendar tile: short weekday, day
 * number and short month, in the viewer's locale. Day-precise like
 * `formatDayAndMonth`; an unreadable value yields empty markers.
 */
export function calendarDateParts(value: string): { weekday: string; day: string; month: string } {
  const date = toDate(DATE_ONLY.test(value) ? `${value}T00:00:00Z` : value);
  if (!date) return { weekday: EMPTY, day: EMPTY, month: EMPTY };
  const part = (options: Intl.DateTimeFormatOptions) => date.toLocaleString(undefined, { ...options, timeZone: "UTC" });
  return { weekday: part({ weekday: "short" }), day: part({ day: "numeric" }), month: part({ month: "short" }) };
}

/**
 * A short list of `YYYY-MM-DD` days as one phrase in the viewer's locale:
 * "Tue 1 Dec and Wed 2 Dec". For the days of one event, so no year.
 */
export function formatDayList(
  values: readonly string[],
  { includeDates = true, weekday = "short" }: { includeDates?: boolean; weekday?: "short" | "long" } = {},
): string {
  const days = values.map((value) => {
    const label = weekday === "long" ? formatWeekday(value) : calendarDateParts(value).weekday;
    return includeDates ? `${label} ${formatDayAndMonth(value)}` : label;
  });
  return new Intl.ListFormat(undefined, { style: "long", type: "conjunction" }).format(days);
}

/**
 * A short list of `YYYY-MM-DD` days of one event with consecutive days
 * joined into one span: "Dec 1 – 2, Dec 4" in the viewer's locale. Day-precise,
 * so it renders on the UTC calendar; unreadable values are left out.
 */
export function formatDaySpans(values: readonly string[]): string {
  const days = [...new Set(values.filter((value) => DATE_ONLY.test(value) && toDate(`${value}T00:00:00Z`)))].sort();
  const spans: Array<[string, string]> = [];
  for (const day of days) {
    const last = spans.at(-1);
    if (last && Date.parse(`${day}T00:00:00Z`) - Date.parse(`${last[1]}T00:00:00Z`) === 86_400_000) last[1] = day;
    else spans.push([day, day]);
  }
  const format = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", timeZone: "UTC" });
  return spans
    .map(([first, last]) =>
      first === last
        ? format.format(new Date(`${first}T00:00:00Z`))
        : format.formatRange(new Date(`${first}T00:00:00Z`), new Date(`${last}T00:00:00Z`)),
    )
    .join(", ");
}

/**
 * An instant that stands for a calendar day — a seat's start, a leadership
 * term's end. A manager picks "1 June 2022" and it is stored as that day's
 * midnight UTC, so the UTC calendar is the value's meaning; rendering it in
 * the viewer's zone would shift it a day west of Greenwich.
 */
export function formatServiceDate(value: string | null | undefined): string {
  if (!value) return EMPTY;
  const date = toDate(DATE_ONLY.test(value) ? `${value}T00:00:00Z` : value);
  if (!date) return EMPTY;
  return date.toLocaleString(undefined, { dateStyle: "medium", timeZone: "UTC" });
}

/**
 * The day of the week of a `YYYY-MM-DD` calendar date — "Tuesday" — in the
 * viewer's locale. Day-precise, so it is read on the UTC calendar.
 */
export function formatWeekday(value: string | null | undefined): string {
  if (!value) return EMPTY;
  const date = toDate(DATE_ONLY.test(value) ? `${value}T00:00:00Z` : value);
  if (!date) return EMPTY;
  return date.toLocaleString(undefined, { weekday: "long", timeZone: "UTC" });
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
 * How long something was held, the way a résumé states it: "Jun 2023 – Present
 * · 3 yrs 5 mos". The ends are service dates, which stand for calendar days,
 * so months are read on the UTC calendar. Both ends count, so a seat taken and
 * left in the same month is "1 mo", never nothing.
 */
export function formatTenure(
  startedAt: string | null | undefined,
  endedAt: string | null | undefined,
  now: number = Date.now(),
): string {
  const start = startedAt ? toDate(DATE_ONLY.test(startedAt) ? `${startedAt}T00:00:00Z` : startedAt) : null;
  const end = endedAt ? toDate(DATE_ONLY.test(endedAt) ? `${endedAt}T00:00:00Z` : endedAt) : new Date(now);
  if (!start || !end) return EMPTY;
  const month = (date: Date) => date.toLocaleString(undefined, { month: "short", year: "numeric", timeZone: "UTC" });
  const months = Math.max(
    1,
    (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + end.getUTCMonth() - start.getUTCMonth() + 1,
  );
  const unit = (value: number, name: "year" | "month") =>
    new Intl.NumberFormat(undefined, { style: "unit", unit: name, unitDisplay: "short" }).format(value);
  const span = [
    months >= 12 ? unit(Math.floor(months / 12), "year") : null,
    months % 12 ? unit(months % 12, "month") : null,
  ]
    .filter(Boolean)
    .join(" ");
  return `${month(start)} – ${endedAt ? month(end) : "Present"} · ${span}`;
}

/**
 * An instant in the viewer's own locale and zone, or an em dash.
 * `seconds` widens the time for audit trails; `zoneName` names the viewer's
 * zone (used where a page shows a converted-to-local time next to UTC
 * source text, so the reader knows whose clock is shown).
 */
export function formatDateTime(
  value: string | null | undefined,
  options: { seconds?: boolean; zoneName?: boolean; fullDate?: boolean } = {},
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
  /*
   * The month by name and the 24-hour clock, the way every other date in the
   * app reads ("Oct 7, 2026, 10:27" in an en-US browser). The short date style
   * wrote "10/7/26, 10:27 AM" in management lists beside "Oct 11, 2026" and an
   * agenda on the 24-hour clock, and a numeric date reads month-first or
   * day-first depending on who is looking.
   */
  return date.toLocaleString(undefined, {
    ...(options.fullDate ? { weekday: "long" as const } : {}),
    year: "numeric",
    month: options.fullDate ? "long" : "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    ...(options.seconds ? { second: "2-digit" as const } : {}),
    hourCycle: "h23",
  });
}

/**
 * The time of day of an instant, in the viewer's own zone and locale, with the
 * zone named — what a `<time class="localTime">` on a public page shows. A
 * value the browser cannot read is the empty marker, never "Invalid Date".
 */
export function formatTimeOfDay(value: string | null | undefined): string {
  if (!value) return EMPTY;
  const date = toDate(value);
  if (!date) return EMPTY;
  return date
    .toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", timeZoneName: "short", hour12: false })
    .replace(",", "");
}

const EVENT_CLOCK_OPTIONS = { hour: "numeric", minute: "2-digit", hour12: false } as const;

/** A clock with its zone named by the surrounding agenda label. */
export function formatClockInZone(value: string, zone: ClockZone): string {
  const date = toDate(value);
  if (!date) return EMPTY;
  return new Intl.DateTimeFormat(undefined, { ...EVENT_CLOCK_OPTIONS, timeZone: clockTimeZone(zone) }).format(date);
}

/**
 * An event's clock range in its configured zone, independent of the viewer's
 * clock, with the clock named by its city — "09:00 – 09:30 Austin time" for an
 * event in Austin on `America/Chicago`. The locale's short zone name would say
 * "CST" or "GMT-6", which changes with daylight saving and names no place.
 */
export function formatTimeRangeInZone(startsAt: string, endsAt: string | undefined, zone: ClockZone): string {
  const clock = formatClockRangeInZone(startsAt, endsAt, zone);
  return clock === EMPTY ? EMPTY : `${clock} ${formatClockName(zone)}`;
}

/**
 * An event's clock range in its configured zone without the clock's name —
 * "09:00 – 09:30" — for a list that names its clock once in its heading.
 */
export function formatClockRangeInZone(startsAt: string, endsAt: string | undefined, zone: ClockZone): string {
  const start = toDate(startsAt);
  if (!start) return EMPTY;
  const end = endsAt ? toDate(endsAt) : null;
  const formatter = new Intl.DateTimeFormat(undefined, { ...EVENT_CLOCK_OPTIONS, timeZone: clockTimeZone(zone) });
  return end && end >= start ? formatter.formatRange(start, end) : formatter.format(start);
}

/** An instant's day on an event's clock as a short weekday and date — "Tue, Dec 1" — without the year. */
export function formatEventDayInZone(value: string, zone: ClockZone): string {
  const date = toDate(value);
  if (!date) return EMPTY;
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: clockTimeZone(zone),
  }).format(date);
}

/**
 * An IANA zone by the city that names it — "Amsterdam", "New York" — the way
 * the agenda's time-zone picker labels the viewer's and the common zones. A
 * city survives daylight saving where "GMT+1" and "CET" do not, and reads as a
 * place rather than a code.
 */
export function formatZoneCity(timeZone: string): string {
  return timeZone === "UTC" ? "UTC" : (timeZone.split("/").pop() ?? timeZone).replaceAll("_", " ");
}

/**
 * The city a clock is named by: an event's own city when it has one, so Austin
 * on `America/Chicago` reads "Austin", otherwise the zone's city. UTC is
 * already the name of a clock.
 */
export function formatClockCity(zone: ClockZone): string {
  const timeZone = clockTimeZone(zone);
  if (timeZone === "UTC") return "UTC";
  return (typeof zone === "string" ? null : zone.city) ?? formatZoneCity(timeZone);
}

/** "Austin time" for an event's clock, "Amsterdam time" for a bare zone; UTC is already the name of a clock. */
export function formatClockName(zone: ClockZone): string {
  return clockTimeZone(zone) === "UTC" ? "UTC" : `${formatClockCity(zone)} time`;
}

/**
 * An instant on the wall clock of a specific IANA zone, on the 24-hour clock
 * the agenda uses, with the clock named by its city so the reader cannot
 * mistake it for their own — "Dec 1, 2026, 09:00 Amsterdam time" in an en-US
 * browser.
 */
export function formatDateTimeInZone(value: string | null | undefined, zone: ClockZone): string {
  const clock = wallClock(value, zone);
  return clock === EMPTY ? EMPTY : `${clock} ${formatClockName(zone)}`;
}

function wallClock(value: string | null | undefined, zone: ClockZone): string {
  if (!value) return EMPTY;
  const date = toDate(value);
  if (!date) return EMPTY;
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: clockTimeZone(zone),
  });
}

/**
 * An event's instant beside the place it happens. The place says whose clock
 * the time is on, so the city is said once — "Dec 1, 2026, 09:00 · Amsterdam,
 * Netherlands" — rather than "09:00 Amsterdam time · Amsterdam, …". Without a
 * place the clock keeps its name (`formatDateTimeInZone`). `place` must be
 * the event's own place on `zone`'s clock, never a room or a call.
 */
export function formatDateTimeAtPlace(
  value: string | null | undefined,
  zone: ClockZone,
  place: string | null | undefined,
): string {
  if (!place) return formatDateTimeInZone(value, zone);
  const clock = wallClock(value, zone);
  return clock === EMPTY ? place : `${clock} · ${place}`;
}

/** The agreed weekday and wall-clock time of a recurring meeting in its IANA zone. */
export function formatWeekdayTimeInZone(value: string, zone: ClockZone): { weekday: string; time: string } {
  const date = toDate(value);
  if (!date) return { weekday: EMPTY, time: EMPTY };
  const timeZone = clockTimeZone(zone);
  const weekday = new Intl.DateTimeFormat(undefined, { weekday: "long", timeZone }).format(date);
  const time = new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone,
  }).format(date);
  return { weekday, time };
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
  format?: { locale?: string; month?: "long" | "short" },
): string {
  if (!startsAt) return EMPTY;
  const options: Intl.DateTimeFormatOptions = {
    day: "numeric",
    month: format?.month ?? "long",
    year: "numeric",
    ...(timeZone ? { timeZone } : {}),
  };
  const formatter = new Intl.DateTimeFormat(format?.locale, options);
  // `Intl.DateTimeFormat.format` throws RangeError on an unreadable value
  // rather than writing "Invalid Date", which takes the whole surface down
  // instead of one line of it. Every other formatter here answers the empty
  // marker; a range is no different (issue #19's class).
  const start = toDate(startsAt);
  if (!start) return EMPTY;
  const end = endsAt ? toDate(endsAt) : null;
  if (!end) return formatter.format(start);
  try {
    return formatter.formatRange(start, end);
  } catch {
    return formatter.format(start);
  }
}

/**
 * How a `<time data-local-time>` element reads.
 *
 * A server-rendered page cannot know its reader's locale or zone, so it writes
 * this rendering as fallback text and `local-time.js` writes it again in the
 * browser. Both call this one function, which is what keeps the two readings
 * of a date from drifting apart.
 *
 * - `date`: a calendar date, or a span of them when `until` is given
 * - `date-time`: an instant with the viewer's zone named
 * - `weekday`: the day of the week of a calendar date
 * - `time`: an instant's time of day with the viewer's zone named
 */
export const LOCAL_TIME_FORMATS = ["date", "date-time", "weekday", "time"] as const;
export type LocalTimeFormat = (typeof LOCAL_TIME_FORMATS)[number];

export function isLocalTimeFormat(value: string | null | undefined): value is LocalTimeFormat {
  return (LOCAL_TIME_FORMATS as readonly string[]).includes(value ?? "");
}

export function formatLocalTime(value: string, format: LocalTimeFormat, until?: string | null): string {
  if (format === "weekday") return formatWeekday(value);
  if (format === "date-time") return formatDateTime(value, { zoneName: true });
  if (format === "time") return formatTimeOfDay(value);
  return until ? formatDateRange(value, until) : formatCalendarDate(value);
}

/**
 * Display policy for event times. The viewer's own registration is the
 * authoritative signal: attending in person shows the venue's clock with its
 * zone named, attending virtually or on demand shows the viewer's local
 * time. Without a registration, a physical venue implies the venue's clock,
 * named by the event's city (`eventClock`);
 * everything else (and deadlines) stays local.
 */
export function formatEventWhen(
  startsAt: string | null | undefined,
  clock: ClockZone | null | undefined,
  location: string | null | undefined,
  attendanceType?: "in_person" | "virtual" | "on_demand" | null,
): string {
  if (attendanceType === "in_person" && clock) return formatDateTimeInZone(startsAt, clock);
  if (attendanceType) return formatDateTime(startsAt);
  if (location && clock) return formatDateTimeInZone(startsAt, clock);
  return formatDateTime(startsAt);
}

/** "today", "tomorrow", "in 95 days" — null when the instant is past or unknown. */
export function formatRelativeDays(instant: string | null | undefined, now = Date.now()): string | null {
  if (!instant) return null;
  const millis = new Date(instant).getTime() - now;
  if (!Number.isFinite(millis)) return null;
  const days = Math.round(millis / 86_400_000);
  if (days < 0) return null;
  return new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }).format(days, "day");
}

/** "4 min", "1 h 5 min": a span of time to the nearest minute. */
export function formatDuration(milliseconds: number): string {
  const minutes = Math.round(milliseconds / 60_000);
  if (minutes < 60) return `${formatNumber(minutes)} min`;
  const rest = minutes % 60;
  return `${formatNumber(Math.floor(minutes / 60))} h${rest ? ` ${formatNumber(rest)} min` : ""}`;
}
