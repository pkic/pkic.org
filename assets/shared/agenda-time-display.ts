import type { z } from "zod";
import type { personalAgendaSessionSchema } from "./schemas/event-personal-agenda";
import { EMPTY_DATE, formatDateRange, formatDateTimeInZone, formatClockInZone } from "./format-date";
import { instantToDateTimeLocal } from "./timezone";

/** Clock selection changes presentation only; venue days and stored UTC instants stay unchanged. */
export function agendaTimeZones(
  eventZone: string,
  browserZone: string,
  attendanceMode: z.infer<typeof personalAgendaSessionSchema>["attendanceMode"],
  showLocalTime = false,
) {
  const remote = attendanceMode === "remote";
  const distinct = eventZone !== browserZone;
  return {
    primary: { zone: remote ? browserZone : eventZone, label: remote ? "Your time" : "Event time" },
    secondary:
      distinct && (remote || showLocalTime)
        ? { zone: remote ? eventZone : browserZone, label: remote ? "Event time" : "Your time" }
        : undefined,
  };
}

export function formatAgendaInstant(value: string | null | undefined, zone: string): string {
  return value ? `${formatDateTimeInZone(value, zone)} (${zone})` : "Time to be announced";
}

export function formatAgendaWindow(startAt: string | null, endAt: string | null, zone: string): string {
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
      return new Intl.DateTimeFormat(locale, { timeZone: zone, timeZoneName: "short" })
        .formatToParts(new Date(value))
        .find((part) => part.type === "timeZoneName")?.value;
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

export function agendaZoneCity(zone: string): string {
  return zone === "UTC" ? "UTC" : (zone.split("/").pop() ?? zone).replaceAll("_", " ");
}

/** "UTC+1" / "UTC−5" for a zone on the agenda's own date, so DST matches the event. */
export function agendaZoneOffset(zone: string, referenceDate: string): string {
  try {
    const value = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "shortOffset" })
      .formatToParts(new Date(`${referenceDate}T12:00:00Z`))
      .find((part) => part.type === "timeZoneName")?.value;
    return (value ?? "UTC").replace("GMT", "UTC").replace("-", "−");
  } catch {
    return "UTC";
  }
}
