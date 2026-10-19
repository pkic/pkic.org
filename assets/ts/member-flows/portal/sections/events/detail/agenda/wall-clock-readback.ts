import { clockTimeZone, type ClockZone } from "../../../../../../../shared/event-clock";
import { formatDateTimeInZone } from "../../../../../../../shared/format-date";
import { dateTimeLocalToIso } from "../../../../../../../shared/timezone";

/**
 * A browser's date and time picker writes the date in the reader's own order (01/12 or 12/01); this reads the
 * typed wall clock back on the event's clock, "Dec 1, 2026, 11:45 Amsterdam time". Nothing while it is empty or
 * not a time the zone has.
 */
export function wallClockReadback(value: string, clock: ClockZone): string | undefined {
  if (!value) return undefined;
  try {
    return formatDateTimeInZone(dateTimeLocalToIso(value, clockTimeZone(clock)), clock);
  } catch {
    return undefined;
  }
}
