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
