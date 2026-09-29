import { AppError } from "../errors";
import { zonedDateTimeParts, zonedDateTimeToDate } from "../../../assets/shared/timezone";

export function isoToDateInTimeZone(iso: string, timeZone: string): string {
  const parts = zonedDateTimeParts(iso, timeZone);
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

export function isoToTimeInTimeZone(iso: string, timeZone: string): string {
  const parts = zonedDateTimeParts(iso, timeZone);
  return `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;
}

export function localDateTimeInTimeZoneToIso(date: string, time: string, timeZone: string): string {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(time);
  if (!dateMatch || !timeMatch) {
    throw new AppError(400, "INVALID_EVENT_DAY_TIME", "Invalid event day date or time");
  }

  const year = parseInt(dateMatch[1], 10);
  const month = parseInt(dateMatch[2], 10);
  const day = parseInt(dateMatch[3], 10);
  const hour = parseInt(timeMatch[1], 10);
  const minute = parseInt(timeMatch[2], 10);

  try {
    return zonedDateTimeToDate({ year, month, day, hour, minute, second: 0 }, timeZone).toISOString();
  } catch {
    throw new AppError(400, "INVALID_EVENT_DAY_TIME", `Time '${time}' is not valid on ${date} in timezone ${timeZone}`);
  }
}
