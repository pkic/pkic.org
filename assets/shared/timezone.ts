export interface ZonedDateTimeParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function formatter(timeZone: string): Intl.DateTimeFormat {
  try {
    return new Intl.DateTimeFormat("en-US-u-ca-gregory", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
  } catch {
    throw new RangeError(`Unknown IANA time zone: ${timeZone}`);
  }
}

export function zonedDateTimeParts(value: string | Date, timeZone: string): ZonedDateTimeParts {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) throw new RangeError("Enter a valid date and time");
  const values = Object.fromEntries(
    formatter(timeZone)
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
    second: values.second,
  };
}

function wallClockEpoch(value: ZonedDateTimeParts): number {
  return Date.UTC(value.year, value.month - 1, value.day, value.hour, value.minute, value.second);
}

/** The IANA offset at an instant, for serializing calendar timezone observances. */
export function zonedUtcOffsetSeconds(value: Date, timeZone: string): number {
  return (wallClockEpoch(zonedDateTimeParts(value, timeZone)) - Math.floor(value.getTime() / 1000) * 1000) / 1000;
}

function sameWallClock(left: ZonedDateTimeParts, right: ZonedDateTimeParts): boolean {
  return (
    left.year === right.year &&
    left.month === right.month &&
    left.day === right.day &&
    left.hour === right.hour &&
    left.minute === right.minute &&
    left.second === right.second
  );
}

function assertCalendarValue(value: ZonedDateTimeParts): void {
  const normalized = new Date(wallClockEpoch(value));
  if (
    normalized.getUTCFullYear() !== value.year ||
    normalized.getUTCMonth() + 1 !== value.month ||
    normalized.getUTCDate() !== value.day ||
    normalized.getUTCHours() !== value.hour ||
    normalized.getUTCMinutes() !== value.minute ||
    normalized.getUTCSeconds() !== value.second
  ) {
    throw new RangeError("Enter a valid calendar date and time");
  }
}

/** Converts a wall clock in one IANA zone to its UTC instant and rejects DST gaps. */
export function zonedDateTimeToDate(value: ZonedDateTimeParts, timeZone: string): Date {
  assertCalendarValue(value);
  const requestedEpoch = wallClockEpoch(value);
  let candidateEpoch = requestedEpoch;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const observed = zonedDateTimeParts(new Date(candidateEpoch), timeZone);
    const adjustment = requestedEpoch - wallClockEpoch(observed);
    if (adjustment === 0 && sameWallClock(observed, value)) return new Date(candidateEpoch);
    candidateEpoch += adjustment;
  }
  if (!sameWallClock(zonedDateTimeParts(new Date(candidateEpoch), timeZone), value)) {
    throw new RangeError(`The selected local time does not exist in ${timeZone} because of daylight saving time`);
  }
  return new Date(candidateEpoch);
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function formatDateTimeLocal(value: ZonedDateTimeParts): string {
  return `${value.year}-${pad(value.month)}-${pad(value.day)}T${pad(value.hour)}:${pad(value.minute)}`;
}

export function parseDateTimeLocal(value: string): ZonedDateTimeParts {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new RangeError("Enter a valid local date and time");
  const parsed = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: 0,
  };
  assertCalendarValue(parsed);
  return parsed;
}

export function instantToDateTimeLocal(value: string | Date, timeZone: string): string {
  return formatDateTimeLocal(zonedDateTimeParts(value, timeZone));
}

export function dateTimeLocalToIso(value: string, timeZone: string): string {
  return zonedDateTimeToDate(parseDateTimeLocal(value), timeZone).toISOString();
}

/** The calendar date (`YYYY-MM-DD`) an instant falls on in a zone. */
export function instantToCalendarDate(value: string | Date, timeZone: string): string {
  return instantToDateTimeLocal(value, timeZone).slice(0, 10);
}

/**
 * The calendar dates from the date `startsAt` falls on to the date `endsAt` falls on, both in `timeZone`,
 * at most `limit` of them. Calendar-date arithmetic only; no instant is widened from a date.
 */
export function calendarDatesBetween(startsAt: string, endsAt: string, timeZone: string, limit = 31): string[] {
  const last = instantToCalendarDate(endsAt, timeZone);
  const dates: string[] = [];
  const cursor = new Date(`${instantToCalendarDate(startsAt, timeZone)}T00:00:00.000Z`);
  while (dates.length < limit) {
    const date = cursor.toISOString().slice(0, 10);
    if (date > last) break;
    dates.push(date);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

/** Whether a string is an IANA zone identifier this runtime knows. */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    formatter(timeZone);
    return true;
  } catch {
    return false;
  }
}

/** The zone the viewer's device is set to, and UTC when the runtime will not say. */
export function viewerTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

/** The 24-hour `HH:MM` clock an instant shows in a zone. */
export function zonedClock(value: string | Date, timeZone: string): string {
  const parts = zonedDateTimeParts(value, timeZone);
  return `${pad(parts.hour)}:${pad(parts.minute)}`;
}

/**
 * The localized name an instant's zone goes by ("CST", "GMT+1" with `short`, "GMT+1" offset form with `shortOffset`),
 * or undefined when the locale has none. Throws a RangeError for an unknown zone.
 */
export function zoneNameAt(
  value: Date,
  timeZone: string,
  locale: string,
  style: "short" | "shortOffset",
): string | undefined {
  return new Intl.DateTimeFormat(locale, { timeZone, timeZoneName: style })
    .formatToParts(value)
    .find((part) => part.type === "timeZoneName")?.value;
}

/** One calendar component of an instant in a zone, in US English ("October", "7", "2026"). */
export function zonedDatePart(value: Date, timeZone: string, part: "day" | "month" | "year"): string {
  const options: Intl.DateTimeFormatOptions =
    part === "day" ? { day: "numeric" } : part === "month" ? { month: "long" } : { year: "numeric" };
  return new Intl.DateTimeFormat("en-US", { timeZone, ...options }).format(value);
}

/**
 * The locale and zone this runtime formats displayed dates with. A build that
 * renders dates through `format-date.ts` depends on both, so a cache key for
 * its output includes them.
 */
export function runtimeDatePresentation(): { locale: string; timeZone: string } {
  const { locale, timeZone } = Intl.DateTimeFormat().resolvedOptions();
  return { locale, timeZone };
}
