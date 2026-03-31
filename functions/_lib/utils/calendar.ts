import { AppError } from "../errors";
import type { EventRecord } from "../services/events";
import { resolveEventVenue, resolveEventVirtualUrl } from "../services/events";

type IcsDateTuple = [number, number, number, number, number];

interface CalendarAlarm {
  action: "display";
  description: string;
  trigger: { hours: number; before: boolean };
}

interface CalendarEvent {
  uid: string;
  title: string;
  description: string;
  url?: string;
  location?: string;
  start: IcsDateTuple;
  end: IcsDateTuple;
  status: "CONFIRMED";
  alarms: CalendarAlarm[];
}

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

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function formatUtc(tuple: IcsDateTuple): string {
  const [year, month, day, hour, minute] = tuple;
  return `${year}${pad(month)}${pad(day)}T${pad(hour)}${pad(minute)}00Z`;
}

function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
}

function buildAlarm(alarm: CalendarAlarm): string {
  const prefix = alarm.trigger.before ? "-" : "";
  return [
    "BEGIN:VALARM",
    `ACTION:${alarm.action.toUpperCase()}`,
    `DESCRIPTION:${escapeIcsText(alarm.description)}`,
    `TRIGGER:${prefix}PT${alarm.trigger.hours}H`,
    "END:VALARM",
  ].join("\r\n");
}

function buildEvent(event: CalendarEvent): string {
  const lines = [
    "BEGIN:VEVENT",
    `UID:${escapeIcsText(event.uid)}`,
    `DTSTAMP:${formatUtc(toUtcTuple(new Date().toISOString()))}`,
    `DTSTART:${formatUtc(event.start)}`,
    `DTEND:${formatUtc(event.end)}`,
    `SUMMARY:${escapeIcsText(event.title)}`,
    `DESCRIPTION:${escapeIcsText(event.description)}`,
    `STATUS:${event.status}`,
  ];

  if (event.url) {
    lines.push(`URL:${escapeIcsText(event.url)}`);
  }
  if (event.location) {
    lines.push(`LOCATION:${escapeIcsText(event.location)}`);
  }

  for (const alarm of event.alarms) {
    lines.push(buildAlarm(alarm));
  }

  lines.push("END:VEVENT");
  return lines.join("\r\n");
}

function buildIcsContent(events: CalendarEvent[]): string {
  if (events.length === 0) {
    throw new AppError(500, "CALENDAR_GENERATION_FAILED", "Unable to generate calendar invite");
  }

  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "PRODID:-//PKI Consortium//Event Registration//EN",
    "X-WR-CALNAME:PKI Consortium Events",
    ...events.map(buildEvent),
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}

/** Standard calendar reminder alarms — 1 day and 1 hour before each event. */
const STANDARD_ALARMS: CalendarAlarm[] = [
  { action: "display", description: "Reminder", trigger: { hours: 24, before: true } },
  { action: "display", description: "Reminder", trigger: { hours: 1, before: true } },
];

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

  const liveDays = dayAttendance.filter((d) => LIVE_ATTENDANCE_TYPES.has(d.attendanceType));

  if (liveDays.length > 0) {
    const isMultiDay = liveDays.length > 1;

    const events: CalendarEvent[] = liveDays.map((day) => {
      const window = toDayWindow(day.dayDate, event.starts_at, event.ends_at);
      const isInPerson = day.attendanceType === "in_person";
      const location = isInPerson ? (venueAddress ?? undefined) : (virtualUrl ?? undefined);
      const url = isInPerson ? manageUrl : (virtualUrl ?? manageUrl);
      const dayLabel = day.label ?? day.dayDate;
      const title = isMultiDay ? `${event.name} – ${dayLabel}` : event.name;
      const eventUid = isMultiDay ? `${registrationId}-${day.dayDate}@pkic.org` : uid;

      return {
        uid: eventUid,
        title,
        description: `Manage your registration at ${manageUrl}`,
        url,
        location,
        start: window.start,
        end: window.end,
        status: "CONFIRMED",
        alarms: STANDARD_ALARMS,
      };
    });

    return { uid, content: buildIcsContent(events) };
  }

  const window = toEventWindow(event);
  const fallbackEvent: CalendarEvent = {
    uid,
    title: event.name,
    description: `Manage your registration at ${manageUrl}`,
    url: manageUrl,
    start: window.start,
    end: window.end,
    status: "CONFIRMED",
    alarms: STANDARD_ALARMS,
  };

  return { uid, content: buildIcsContent([fallbackEvent]) };
}
