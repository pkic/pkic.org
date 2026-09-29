import ICAL from "ical.js";
import { zonedDateTimeParts, zonedDateTimeToDate, type ZonedDateTimeParts } from "../../../../assets/shared/timezone";
import { AppError } from "../../errors";

/** Converts a floating recurrence value to UTC while preserving local wall-clock time across DST. */
function localDateTimeToUtc(value: ZonedDateTimeParts, timeZone: string): Date {
  try {
    return zonedDateTimeToDate(value, timeZone);
  } catch {
    throw new AppError(
      422,
      "EVENT_RECURRENCE_LOCAL_TIME_INVALID",
      "The recurrence contains a local time that does not exist in the configured timezone",
    );
  }
}

export function expandStarts(
  startsAt: string,
  timeZone: string,
  recurrenceRule: string,
  through: string,
  maximum: number,
  from?: string,
): string[] {
  const anchor = new Date(startsAt);
  const horizon = new Date(through);
  if (horizon <= anchor) {
    throw new AppError(
      422,
      "EVENT_RECURRENCE_HORIZON_INVALID",
      "The materialization horizon must follow the series start",
    );
  }
  try {
    const localAnchor = zonedDateTimeParts(anchor, timeZone);
    const iterator = ICAL.Recur.fromString(recurrenceRule).iterator(
      ICAL.Time.fromData({ ...localAnchor, isDate: false }),
    );
    const starts: string[] = [];
    let iterations = 0;
    for (let next = iterator.next(); next; next = iterator.next()) {
      if (++iterations > 50_000)
        throw new AppError(
          422,
          "EVENT_RECURRENCE_LIMIT_EXCEEDED",
          "The recurrence exceeds the supported expansion range",
        );
      const instant = localDateTimeToUtc(
        {
          year: next.year,
          month: next.month,
          day: next.day,
          hour: next.hour,
          minute: next.minute,
          second: next.second,
        },
        timeZone,
      );
      if (instant > horizon) break;
      if (from && instant.toISOString() < from) continue;
      starts.push(instant.toISOString());
      if (starts.length > maximum) {
        throw new AppError(
          422,
          "EVENT_RECURRENCE_LIMIT_EXCEEDED",
          "The requested horizon exceeds the bounded occurrence limit",
        );
      }
    }
    return starts;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(422, "EVENT_RECURRENCE_INVALID", "The recurrence rule could not be expanded");
  }
}
