import { formatDateTimeLocal, zonedDateTimeParts } from "../../../../../shared/timezone";
import { browserTimeZone, isoDateTimeValue, localDateTimeValue } from "../../../../shared/ui";

/** A meeting names its own IANA zone and passes it to the shared codec. */
export { isoDateTimeValue, localDateTimeValue };

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
