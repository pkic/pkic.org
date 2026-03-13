import { AppError } from "../errors";

function getFormatter(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
}

function getZonedParts(date: Date, timeZone: string): Record<string, number> {
  const parts = getFormatter(timeZone).formatToParts(date);
  const out: Record<string, number> = {};
  for (const part of parts) {
    if (part.type === "year" || part.type === "month" || part.type === "day"
      || part.type === "hour" || part.type === "minute" || part.type === "second") {
      out[part.type] = parseInt(part.value, 10);
    }
  }
  return out;
}

function getOffsetMinutes(date: Date, timeZone: string): number {
  const parts = getZonedParts(date, timeZone);
  const zonedAsUtc = Date.UTC(
    parts.year,
    (parts.month ?? 1) - 1,
    parts.day ?? 1,
    parts.hour ?? 0,
    parts.minute ?? 0,
    parts.second ?? 0,
  );
  return (zonedAsUtc - date.getTime()) / 60_000;
}

export function isoToDateInTimeZone(iso: string, timeZone: string): string {
  const parts = getZonedParts(new Date(iso), timeZone);
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

export function isoToTimeInTimeZone(iso: string, timeZone: string): string {
  const parts = getZonedParts(new Date(iso), timeZone);
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

  let utcMs = Date.UTC(year, month - 1, day, hour, minute, 0);
  for (let index = 0; index < 3; index += 1) {
    const offsetMinutes = getOffsetMinutes(new Date(utcMs), timeZone);
    const nextUtcMs = Date.UTC(year, month - 1, day, hour, minute, 0) - offsetMinutes * 60_000;
    if (nextUtcMs === utcMs) break;
    utcMs = nextUtcMs;
  }

  const iso = new Date(utcMs).toISOString();
  if (isoToDateInTimeZone(iso, timeZone) !== date || isoToTimeInTimeZone(iso, timeZone) !== time) {
    throw new AppError(
      400,
      "INVALID_EVENT_DAY_TIME",
      `Time '${time}' is not valid on ${date} in timezone ${timeZone}`,
    );
  }

  return iso;
}