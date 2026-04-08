import { AppError } from "../errors";
import ICAL from "ical.js";
import type { EventRecord } from "../services/events";
import { resolveEventVenue, resolveEventVirtualUrl } from "../services/events";

type IcsDateTuple = [number, number, number, number, number];

interface CalendarEvent {
  uid: string;
  title: string;
  description: string;
  url?: string;
  location?: string;
  organizerEmail?: string;
  attendeeEmail?: string;
  start: IcsDateTuple;
  end: IcsDateTuple;
  status: "CONFIRMED";
  alarms: CalendarAlarm[];
}

interface CalendarAlarm {
  action: "display";
  description: string;
  trigger: { hours?: number; minutes?: number; before: boolean };
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

function toIcalTime(tuple: IcsDateTuple): InstanceType<typeof ICAL.Time> {
  const [year, month, day, hour, minute] = tuple;
  return ICAL.Time.fromJSDate(new Date(Date.UTC(year, month - 1, day, hour, minute, 0)), true);
}

function buildAlarm(alarm: CalendarAlarm): InstanceType<typeof ICAL.Component> {
  const component = new ICAL.Component("valarm");
  component.addPropertyWithValue("action", alarm.action.toUpperCase());
  component.addPropertyWithValue("description", alarm.description);
  component.addPropertyWithValue(
    "trigger",
    ICAL.Duration.fromData({
      hours: alarm.trigger.hours ?? 0,
      minutes: alarm.trigger.minutes ?? 0,
      isNegative: alarm.trigger.before,
    }),
  );
  return component;
}

function buildEventComponent(event: CalendarEvent): InstanceType<typeof ICAL.Component> {
  const component = new ICAL.Component("vevent");
  component.addPropertyWithValue("uid", event.uid);
  component.addPropertyWithValue("dtstamp", ICAL.Time.now());
  component.addPropertyWithValue("dtstart", toIcalTime(event.start));
  component.addPropertyWithValue("dtend", toIcalTime(event.end));
  component.addPropertyWithValue("summary", event.title);
  component.addPropertyWithValue("description", event.description);
  component.addPropertyWithValue("status", event.status);

  if (event.url) {
    component.addPropertyWithValue("url", event.url);
  }
  if (event.location) {
    component.addPropertyWithValue("location", event.location);
  }

  if (event.organizerEmail) {
    const org = new ICAL.Property("organizer");
    org.setParameter("cn", "PKI Consortium Events");
    org.setValue(`mailto:${event.organizerEmail}`);
    component.addProperty(org);
  }

  if (event.attendeeEmail) {
    const att = new ICAL.Property("attendee");
    att.setParameter("role", "REQ-PARTICIPANT");
    att.setParameter("partstat", "NEEDS-ACTION");
    att.setParameter("rsvp", "TRUE");
    att.setValue(`mailto:${event.attendeeEmail}`);
    component.addProperty(att);
  }

  for (const alarm of event.alarms) {
    component.addSubcomponent(buildAlarm(alarm));
  }

  return component;
}

function buildIcsContent(events: CalendarEvent[]): string {
  if (events.length === 0) {
    throw new AppError(500, "CALENDAR_GENERATION_FAILED", "Unable to generate calendar invite");
  }

  try {
    const calendar = new ICAL.Component("vcalendar");
    calendar.addPropertyWithValue("version", "2.0");
    calendar.addPropertyWithValue("calscale", "GREGORIAN");
    calendar.addPropertyWithValue("method", "REQUEST");
    calendar.addPropertyWithValue("prodid", "-//PKI Consortium//Event Registration//EN");
    calendar.addPropertyWithValue("x-wr-calname", "PKI Consortium Events");

    for (const event of events) {
      calendar.addSubcomponent(buildEventComponent(event));
    }

    const content = calendar.toString();
    return content.endsWith("\r\n") ? content : `${content}\r\n`;
  } catch {
    throw new AppError(500, "CALENDAR_GENERATION_FAILED", "Unable to generate calendar invite");
  }
}

/** Standard calendar reminder alarms — 1 day, 1 hour, 15 minutes, and 5 minutes before each event. */
const STANDARD_ALARMS: CalendarAlarm[] = [
  { action: "display", description: "Reminder", trigger: { hours: 24, before: true } },
  { action: "display", description: "Reminder", trigger: { hours: 1, before: true } },
  { action: "display", description: "Reminder", trigger: { minutes: 15, before: true } },
  { action: "display", description: "Reminder", trigger: { minutes: 5, before: true } },
];

export interface DayAttendanceEntry {
  dayDate: string;
  attendanceType: string;
  label: string | null;
}

export interface IcsFile {
  uid: string;
  filename: string;
  content: string;
}

/** Returns the lowercase weekday name (e.g. "tuesday") for a YYYY-MM-DD date string, evaluated in UTC. */
function dayOfWeekName(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" }).toLowerCase();
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
export async function buildRegistrationIcs(
  event: EventRecord,
  registrationId: string,
  manageUrl: string,
  dayAttendance: DayAttendanceEntry[] = [],
  appBaseUrl?: string,
  rsvpEmail?: string,
  attendeeEmail?: string,
  signingSecret?: string,
): Promise<{ uid: string; files: IcsFile[]; inlineContent?: string }> {
  const uid = `${registrationId}@pkic.org`;
  const baseUrl = appBaseUrl ?? "https://pkic.org";

  const venueAddress = resolveEventVenue(event);
  const virtualUrl = resolveEventVirtualUrl(event, baseUrl);

  const liveDays = dayAttendance.filter((d) => LIVE_ATTENDANCE_TYPES.has(d.attendanceType));

  if (liveDays.length > 0) {
    const isMultiDay = liveDays.length > 1;

    const calEvents: Array<{ dayDate: string; eventUid: string; calEvent: CalendarEvent }> = await Promise.all(
      liveDays.map(async (day) => {
        const window = toDayWindow(day.dayDate, event.starts_at, event.ends_at);
        const isInPerson = day.attendanceType === "in_person";
        const location = isInPerson ? (venueAddress ?? undefined) : (virtualUrl ?? undefined);
        const url = isInPerson ? manageUrl : (virtualUrl ?? manageUrl);
        const dayLabel = day.label ?? day.dayDate;
        const title = isMultiDay ? `${event.name} – ${dayLabel}` : event.name;
        const eventUid = isMultiDay ? `${registrationId}-${day.dayDate}@pkic.org` : uid;

        // For multi-day events, use a per-day RSVP address so implicit email replies
        // (subject-line declines without an ICS attachment) can be mapped to the correct day.
        let eventRsvpEmail = rsvpEmail;
        if (isMultiDay && rsvpEmail && signingSecret) {
          const { generateSignedRsvpAddress } = await import("../email/rsvp");
          eventRsvpEmail = await generateSignedRsvpAddress(registrationId, signingSecret, rsvpEmail, day.dayDate);
        }

        const calEvent: CalendarEvent = {
          uid: eventUid,
          title,
          description: `Manage your registration at ${manageUrl}`,
          url,
          location,
          organizerEmail: eventRsvpEmail,
          attendeeEmail,
          start: window.start,
          end: window.end,
          status: "CONFIRMED",
          alarms: STANDARD_ALARMS,
        };

        return { dayDate: day.dayDate, eventUid, calEvent };
      })
    );

    // Single combined VCALENDAR with all VEVENTs as attachment.
    // No inline text/calendar for multi-day: Outlook's inline prompt only
    // processes the first VEVENT and then deletes the email, losing the rest.
    // Users open the attachment to import all days at once.
    const combinedContent = buildIcsContent(calEvents.map(({ calEvent }) => calEvent));
    const files: IcsFile[] = [{ uid, filename: "invite.ics", content: combinedContent }];

    return { uid, files };
  }

  const window = toEventWindow(event);
  const fallbackEvent: CalendarEvent = {
    uid,
    title: event.name,
    description: `Manage your registration at ${manageUrl}`,
    url: manageUrl,
    organizerEmail: rsvpEmail,
    attendeeEmail,
    start: window.start,
    end: window.end,
    status: "CONFIRMED",
    alarms: STANDARD_ALARMS,
  };

  const fallbackContent = buildIcsContent([fallbackEvent]);
  return { uid, files: [{ uid, filename: "invite.ics", content: fallbackContent }], inlineContent: fallbackContent };
}
