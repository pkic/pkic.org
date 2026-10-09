/**
 * The words the event home greets an attendee with: a greeting for the
 * reader's own clock, and where the event stands relative to now.
 *
 * Both are presentation only. The greeting uses the device's local hour, since
 * it answers "what time is it for me"; the event day uses the event's own time
 * zone, since "day 2" is the event's calendar, not the reader's.
 */
import { zonedDateTimeParts } from "../../../../../../shared/timezone";

export function greetingFor(localHour: number): string {
  if (localHour >= 5 && localHour < 12) return "Good morning";
  if (localHour >= 12 && localHour < 18) return "Good afternoon";
  if (localHour >= 18 && localHour < 23) return "Good evening";
  return "Hello, night owl";
}

export type EventCountdown =
  | { kind: "days"; days: number }
  | { kind: "hours"; hours: number; minutes: number }
  | { kind: "live"; day: number; of: number }
  | { kind: "ended" }
  | { kind: "unscheduled" };

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** A `YYYY-MM-DD` calendar date of an instant in the event's zone, through the shared zone codec. */
export function calendarDate(instant: number, timeZone: string): string {
  const { year, month, day } = zonedDateTimeParts(new Date(instant), timeZone);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);
}

export function eventCountdown(
  now: number,
  startsAt: string | null,
  endsAt: string | null,
  timeZone: string | null,
): EventCountdown {
  if (!startsAt) return { kind: "unscheduled" };
  const start = Date.parse(startsAt);
  const end = endsAt ? Date.parse(endsAt) : start;
  if (now >= end && endsAt) return { kind: "ended" };
  if (now < start) {
    const left = start - now;
    if (left >= 2 * DAY) return { kind: "days", days: Math.floor(left / DAY) };
    return { kind: "hours", hours: Math.floor(left / HOUR), minutes: Math.floor((left % HOUR) / MINUTE) };
  }
  const zone = timeZone ?? "UTC";
  const first = calendarDate(start, zone);
  return {
    kind: "live",
    day: daysBetween(first, calendarDate(now, zone)) + 1,
    of: daysBetween(first, calendarDate(end, zone)) + 1,
  };
}

/** The countdown in words, for the welcome banner. */
export function countdownLabel(countdown: EventCountdown): string | null {
  switch (countdown.kind) {
    case "days":
      return `${countdown.days} days to go`;
    case "hours":
      return countdown.hours > 0
        ? `Starts in ${countdown.hours} h ${countdown.minutes} min`
        : `Starts in ${countdown.minutes} min`;
    case "live":
      return countdown.of > 1 ? `Day ${countdown.day} of ${countdown.of} · happening now` : "Happening now";
    case "ended":
      return "Thank you for being part of it";
    case "unscheduled":
      return null;
  }
}
