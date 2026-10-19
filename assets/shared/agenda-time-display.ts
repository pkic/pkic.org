import type { z } from "zod";
import type { personalAgendaSessionSchema } from "./schemas/event-personal-agenda";
import {
  EMPTY_DATE,
  formatClockName,
  formatDateRange,
  formatDateTimeInZone,
  formatClockInZone,
  formatZoneCity,
} from "./format-date";
import { clockTimeZone, type ClockZone } from "./event-clock";
import { instantToDateTimeLocal, zoneNameAt } from "./timezone";

/**
 * Clock selection changes presentation only; venue days and stored UTC instants stay unchanged.
 * The event's clock keeps its city, the browser's is named by its own zone.
 */
export function agendaTimeZones(
  eventZone: ClockZone,
  browserZone: string,
  attendanceMode: z.infer<typeof personalAgendaSessionSchema>["attendanceMode"],
  showLocalTime = false,
): {
  primary: { zone: ClockZone; label: string };
  secondary: { zone: ClockZone; label: string } | undefined;
} {
  const remote = attendanceMode === "remote";
  const distinct = clockTimeZone(eventZone) !== browserZone;
  return {
    primary: { zone: remote ? browserZone : eventZone, label: remote ? "Your time" : "Event time" },
    secondary:
      distinct && (remote || showLocalTime)
        ? { zone: remote ? eventZone : browserZone, label: remote ? "Event time" : "Your time" }
        : undefined,
  };
}

export function formatAgendaInstant(value: string | null | undefined, zone: ClockZone): string {
  // The formatter names the zone by its city already; the identifier again in
  // brackets said it twice.
  return value ? formatDateTimeInZone(value, zone) : "Time to be announced";
}

export function formatAgendaWindow(startAt: string | null, endAt: string | null, zone: ClockZone): string {
  return startAt
    ? formatAgendaInstant(startAt, zone) + (endAt ? ` – ${formatAgendaInstant(endAt, zone)}` : "")
    : "Time to be announced";
}

/** Include the local calendar date when the browser clock crosses the venue day. */
export function agendaLocalClock(value: string, eventZone: string, browserZone: string) {
  try {
    const venueDate = instantToDateTimeLocal(value, eventZone).slice(0, 10);
    const localDate = instantToDateTimeLocal(value, browserZone).slice(0, 10);
    return {
      time: formatClockInZone(value, browserZone),
      date: localDate !== venueDate ? formatDateRange(value, undefined, browserZone) : undefined,
    };
  } catch {
    return { time: EMPTY_DATE, date: undefined };
  }
}

/** A short zone name for a clock ("CST", "CET"), falling back to an offset ("GMT+8"). */
export function agendaZoneAbbreviation(value: string, zone: string): string {
  const name = (locale: string) => {
    try {
      return zoneNameAt(new Date(value), zone, locale, "short");
    } catch {
      return undefined;
    }
  };
  const american = name("en-US");
  if (american && !american.startsWith("GMT")) return american;
  const british = name("en-GB");
  return british && !british.startsWith("GMT") ? british : (american ?? "");
}

/** The design's short list of zones offered beside the event and device zones. */
export const AGENDA_COMMON_TIME_ZONES = [
  "Europe/London",
  "Europe/Amsterdam",
  "America/New_York",
  "America/Chicago",
  "America/Los_Angeles",
  "America/Sao_Paulo",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
  "UTC",
] as const;

/** A device or listed zone by its own city; an event's clock is named by `formatClockCity`. */
export const agendaZoneCity = formatZoneCity;

/**
 * When a session runs on the event's own clock: "1 December 2026" and "11:00–11:45 Austin time", naming the
 * clock the way every other agenda time does.
 * The 24-hour clock and the event's city match the agenda's venue time choice; the parts stay apart
 * so a narrow line can wrap between the date and the times, never inside the times.
 */
export function agendaSessionWhen(
  startAt: string,
  endAt: string | null | undefined,
  zone: ClockZone,
): { date: string; time: string } {
  const start = formatClockInZone(startAt, zone);
  const end = endAt ? formatClockInZone(endAt, zone) : undefined;
  return {
    date: formatDateRange(startAt, undefined, clockTimeZone(zone)),
    time: `${end ? `${start}–${end}` : start} ${formatClockName(zone)}`,
  };
}

/** "UTC+1" / "UTC−5" for a zone on the agenda's own date, so DST matches the event. */
export function agendaZoneOffset(zone: string, referenceDate: string): string {
  try {
    const value = zoneNameAt(new Date(`${referenceDate}T12:00:00Z`), zone, "en-US", "shortOffset");
    return (value ?? "UTC").replace("GMT", "UTC").replace("-", "−");
  } catch {
    return "UTC";
  }
}
