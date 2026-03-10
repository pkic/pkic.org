import { createEvents, type EventAttributes } from "ics";
import { AppError } from "../errors";
import type { EventRecord } from "../services/events";
import { resolveEventVenue, resolveEventVirtualUrl } from "../services/events";

type IcsDateTuple = [number, number, number, number, number];

/** Attendance types that represent a scheduled live attendance (in-person or livestream). */
const LIVE_ATTENDANCE_TYPES = new Set(["in_person", "virtual", "live"]);

function toUtcTuple(value: string): IcsDateTuple {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new AppError(400, "CALENDAR_INVALID_DATE", `Invalid calendar date: ${value}`);
  }

  return [
    date.getUTCFullYear(),
    date.getUTCMonth() + 1,
    date.getUTCDate(),
    date.getUTCHours(),
    date.getUTCMinutes(),
  ];
}

/**
 * Combines a YYYY-MM-DD day date with the time-of-day from the event's
 * starts_at / ends_at to build per-day start and end tuples.
 * Falls back to 09:00–18:00 UTC when the event has no times set.
 */
function toDayWindow(
  dayDate: string,
  eventStartsAt: string | null,
  eventEndsAt: string | null,
): { start: IcsDateTuple; end: IcsDateTuple } {
  const startDate = eventStartsAt ? new Date(eventStartsAt) : null;
  const endDate = eventEndsAt ? new Date(eventEndsAt) : null;

  const startHour = startDate && !Number.isNaN(startDate.getTime()) ? startDate.getUTCHours() : 9;
  const startMinute = startDate && !Number.isNaN(startDate.getTime()) ? startDate.getUTCMinutes() : 0;
  const endHour = endDate && !Number.isNaN(endDate.getTime()) ? endDate.getUTCHours() : 18;
  const endMinute = endDate && !Number.isNaN(endDate.getTime()) ? endDate.getUTCMinutes() : 0;

  const parts = dayDate.split("-").map(Number);
  const [year, month, day] = parts;

  return {
    start: [year, month, day, startHour, startMinute],
    end: [year, month, day, endHour, endMinute],
  };
}

function toEventWindow(event: EventRecord): { start: IcsDateTuple; end: IcsDateTuple } {
  const now = new Date().toISOString();
  const startSource = event.starts_at ?? now;
  const startDate = new Date(startSource);

  const defaultEndDate = new Date(startDate.getTime() + 60 * 60 * 1000).toISOString();
  const endSource = event.ends_at ?? defaultEndDate;

  return {
    start: toUtcTuple(startSource),
    end: toUtcTuple(endSource),
  };
}

function buildIcsContent(eventAttribs: EventAttributes[]): string {
  const { error, value } = createEvents(eventAttribs);
  if (error || !value) {
    throw new AppError(500, "CALENDAR_GENERATION_FAILED", "Unable to generate calendar invite", { error });
  }

  return value;
}

/** Standard calendar reminder alarms — 1 day and 1 hour before each event. */
const STANDARD_ALARMS: EventAttributes["alarms"] = [
  { action: "display", description: "Reminder", trigger: { hours: 24, before: true } },
  { action: "display", description: "Reminder", trigger: { hours: 1, before: true } },
];

/** Shared VCALENDAR-level properties applied to every generated event. */
const CALENDAR_DEFAULTS: Partial<EventAttributes> = {
  productId: "-//PKI Consortium//Event Registration//EN",
  calName: "PKI Consortium Events",
  startInputType: "utc" as const,
  startOutputType: "utc" as const,
  endInputType: "utc" as const,
  endOutputType: "utc" as const,
  status: "CONFIRMED" as const,
  alarms: STANDARD_ALARMS,
};

export interface DayAttendanceEntry {
  dayDate: string;
  attendanceType: string;
  label: string | null;
}

/**
 * Builds the ICS calendar attachment for a registration confirmation email.
 *
 * Behaviour:
 * - Multi-day registrations with per-day attendance produce one VEVENT per
 *   live day (in_person or virtual), skipping on_demand days (recorded content
 *   has no fixed schedule).
 * - Each VEVENT uses the event's daily start/end times (derived from
 *   event.starts_at / event.ends_at) — e.g. 09:00–18:00 UTC for every day.
 * - Location is set per attendance type:
 *     in_person → venue address from settings_json.venue
 *     virtual   → virtual page URL (settings_json.virtualUrl or auto-derived)
 * - Both in-person and virtual VEVENTs include 24 h and 1 h display reminders.
 * - Falls back to a single spanning event when no live day attendance is present.
 */
export function buildRegistrationIcs(
  event: EventRecord,
  registrationId: string,
  manageUrl: string,
  dayAttendance: DayAttendanceEntry[] = [],
  appBaseUrl?: string,
): { uid: string; content: string } {
  const uid = `${registrationId}@pkic.org`;
  const baseUrl = appBaseUrl ?? "https://pkic.org";

  const venueAddress = resolveEventVenue(event);
  const virtualUrl = resolveEventVirtualUrl(event, baseUrl);

  // Collect only days where the attendee has a live time commitment.
  const liveDays = dayAttendance.filter((d) => LIVE_ATTENDANCE_TYPES.has(d.attendanceType));

  if (liveDays.length > 0) {
    const isMultiDay = liveDays.length > 1;

    const eventAttribs: EventAttributes[] = liveDays.map((day) => {
      const window = toDayWindow(day.dayDate, event.starts_at, event.ends_at);
      const isInPerson = day.attendanceType === "in_person";

      const location = isInPerson ? (venueAddress ?? undefined) : (virtualUrl ?? undefined);
      const url = isInPerson ? manageUrl : (virtualUrl ?? manageUrl);

      // For multi-day events, suffix the title with the day label so that calendar
      // apps display distinct entries (e.g. "PQC Conference – Tuesday 1 December 2026").
      const dayLabel = day.label ?? day.dayDate;
      const title = isMultiDay ? `${event.name} – ${dayLabel}` : event.name;

      // Stable per-day UID so calendar apps can update individual days if the
      // ICS is resent (e.g. after a registration update).
      const eventUid = isMultiDay ? `${registrationId}-${day.dayDate}@pkic.org` : uid;

      return {
        ...CALENDAR_DEFAULTS,
        uid: eventUid,
        title,
        description: `Manage your registration at ${manageUrl}`,
        url,
        location,
        start: window.start,
        end: window.end,
      } as EventAttributes;
    });

    return { uid, content: buildIcsContent(eventAttribs) };
  }

  // Fallback: single event spanning the full event duration.
  // Used for on_demand-only registrations or when no day attendance is recorded.
  const window = toEventWindow(event);
  const fallbackAttribs: EventAttributes = {
    ...CALENDAR_DEFAULTS,
    uid,
    title: event.name,
    description: `Manage your registration at ${manageUrl}`,
    url: manageUrl,
    start: window.start,
    end: window.end,
  } as EventAttributes;

  return { uid, content: buildIcsContent([fallbackAttribs]) };
}
