import {
  dateTimeLocalToIso,
  formatDateTimeLocal,
  instantToDateTimeLocal,
  zonedDateTimeParts,
} from "../../../../../shared/timezone";

function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

/** Renders an instant as a date-time-local value in the meeting's IANA zone. */
export function localDateTimeValue(value: string | Date, timeZone = browserTimeZone()): string {
  return instantToDateTimeLocal(value, timeZone);
}

/** Converts a meeting-zone wall clock into an instant and rejects DST gaps. */
export function isoDateTimeValue(value: string, timeZone = browserTimeZone()): string {
  return dateTimeLocalToIso(value, timeZone);
}

export function defaultFutureDate(days: number, hour = 23, minute = 59, timeZone = browserTimeZone()): string {
  const current = zonedDateTimeParts(new Date(), timeZone);
  const future = new Date(Date.UTC(current.year, current.month - 1, current.day + days, hour, minute));
  return formatDateTimeLocal({
    year: future.getUTCFullYear(),
    month: future.getUTCMonth() + 1,
    day: future.getUTCDate(),
    hour: future.getUTCHours(),
    minute: future.getUTCMinutes(),
    second: 0,
  });
}
