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
