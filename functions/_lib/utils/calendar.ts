import { AppError } from "../errors";
import ICAL from "ical.js";
import type { EventRecord } from "../services/events";
import { resolveEventVenue, resolveEventVirtualUrl } from "../services/events";
import { generateSignedRsvpAddress } from "../email/rsvp";
import {
  eventAttendanceAccessMode,
  type EventAttendanceAccessMode,
} from "../../../assets/shared/event-attendance-access";
import { zonedDateTimeParts, zonedDateTimeToDate } from "../../../assets/shared/timezone";
import { formatEventPlace } from "../../../assets/shared/event-place";

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

function toUtcTuple(value: string): IcsDateTuple {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new AppError(400, "CALENDAR_INVALID_DATE", `Invalid calendar date: ${value}`);
  }

  return [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), date.getUTCHours(), date.getUTCMinutes()];
}

/** Resolve day wall times through the event zone; explicit day instants take precedence. */
function toDayWindow(
  day: DayAttendanceEntry,
  event: Pick<EventRecord, "starts_at" | "ends_at" | "timezone">,
): { start: IcsDateTuple; end: IcsDateTuple } {
  const [year, month, date] = day.dayDate.split("-").map(Number);
  const resolve = (dayInstant: string | null | undefined, eventInstant: string | null, defaultHour: number) => {
    if (dayInstant) return toUtcTuple(dayInstant);
    const clock = eventInstant
      ? zonedDateTimeParts(eventInstant, event.timezone)
      : { hour: defaultHour, minute: 0, second: 0 };
    return toUtcTuple(
      zonedDateTimeToDate(
        { year, month, day: date, hour: clock.hour, minute: clock.minute, second: clock.second },
        event.timezone,
      ).toISOString(),
    );
  };
  return { start: resolve(day.startsAt, event.starts_at, 9), end: resolve(day.endsAt, event.ends_at, 18) };
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
  accessMode?: EventAttendanceAccessMode;
  startsAt?: string | null;
  endsAt?: string | null;
}

/** Only accepted or unqueued days can appear as confirmed calendar events. */
export function calendarConfirmedDays<T extends DayAttendanceEntry>(
  days: T[],
  waitlist: Array<{ dayDate: string; status: string }>,
): T[] {
  return days.filter((day) => !waitlist.some((entry) => entry.dayDate === day.dayDate && entry.status !== "accepted"));
}

export interface IcsFile {
  uid: string;
  filename: string;
  content: string;
}

/** Build calendar events for confirmed live attendance days. */
export async function buildRegistrationIcs(
  event: Pick<EventRecord, "name" | "slug" | "base_path" | "starts_at" | "ends_at" | "settings_json" | "timezone"> &
    Partial<Pick<EventRecord, "city" | "country">>,
  registrationId: string,
  /** The registration's sign-in page; a calendar entry is shared too widely to carry a management link. */
  registrationUrl: string,
  dayAttendance: DayAttendanceEntry[] = [],
  appBaseUrl?: string,
  rsvpEmail?: string,
  attendeeEmail?: string,
  signingSecret?: string,
): Promise<{ uid: string; files: IcsFile[]; inlineContent?: string }> {
  const uid = `${registrationId}@pkic.org`;
  const baseUrl = appBaseUrl ?? "https://pkic.org";

  // A calendar file has no reader locale, so the country is named in English.
  const venueAddress = resolveEventVenue(event) ?? formatEventPlace(event, "en");
  const virtualUrl = resolveEventVirtualUrl(event, baseUrl);

  const liveDays = dayAttendance.filter(
    (day) => eventAttendanceAccessMode({ value: day.attendanceType, accessMode: day.accessMode }) !== "none",
  );

  if (liveDays.length > 0) {
    const isMultiDay = liveDays.length > 1;

    const calEvents: Array<{ dayDate: string; eventUid: string; calEvent: CalendarEvent }> = await Promise.all(
      liveDays.map(async (day) => {
        const window = toDayWindow(day, event);
        const isInPerson =
          eventAttendanceAccessMode({ value: day.attendanceType, accessMode: day.accessMode }) === "physical";
        const location = isInPerson ? (venueAddress ?? undefined) : (virtualUrl ?? undefined);
        const url = isInPerson ? registrationUrl : (virtualUrl ?? registrationUrl);
        const dayLabel = day.label ?? day.dayDate;
        const title = isMultiDay ? `${event.name} – ${dayLabel}` : event.name;
        const eventUid = isMultiDay ? `${registrationId}-${day.dayDate}@pkic.org` : uid;

        // For multi-day events, use a per-day RSVP address so implicit email replies
        // (subject-line declines without an ICS attachment) can be mapped to the correct day.
        let eventRsvpEmail = rsvpEmail;
        if (isMultiDay && rsvpEmail && signingSecret) {
          eventRsvpEmail = await generateSignedRsvpAddress(registrationId, signingSecret, rsvpEmail, day.dayDate);
        }

        const calEvent: CalendarEvent = {
          uid: eventUid,
          title,
          description: `View your registration at ${registrationUrl}`,
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
      }),
    );

    // Single combined VCALENDAR with all VEVENTs as attachment.
    // No inline text/calendar for multi-day: Outlook's inline prompt only
    // processes the first VEVENT and then deletes the email, losing the rest.
    // Users open the attachment to import all days at once.
    const combinedContent = buildIcsContent(calEvents.map(({ calEvent }) => calEvent));
    const files: IcsFile[] = [{ uid, filename: "invite.ics", content: combinedContent }];

    return { uid, files };
  }

  return { uid, files: [] };
}
