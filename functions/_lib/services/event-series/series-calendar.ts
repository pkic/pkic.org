import {
  MEETING_PERSONAL_CALENDAR_NOTICE,
  outboundMeetingLocation,
} from "../../../../assets/shared/meeting-calendar-policy";
import { meetingSeriesEntryUrl } from "../../../../assets/shared/meeting-entry-navigation";
import ICAL from "ical.js";
import { zonedDateTimeParts, zonedDateTimeToDate } from "../../../../assets/shared/timezone";
import { meetingCalendarThrough } from "../../../../assets/shared/meeting-calendar-policy";
import { buildCalendarTimezone } from "./calendar-timezone";
import { expandStarts } from "./recurrence-expansion";
import { meetingCalendarFilename } from "./calendar-filename";
import type { CalendarPayload } from "../../email/outbox-queue";

export interface SeriesCalendarOccurrence {
  id: string;
  starts_at: string;
  recurrence_id: string;
  ends_at: string;
  status: string;
  location: string | null;
}
export interface SeriesCalendar {
  id: string;
  event_id: string;
  owner_group_id: string;
  owner_group_slug?: string;
  event_name: string;
  starts_at: string;
  recurrence_rule: string;
  duration_minutes: number;
  timezone: string;
  location: string | null;
  calendar_revision: number;
  calendar_through: string | null;
}

export function seriesCalendarUrl(baseUrl: string, series: SeriesCalendar): string {
  return `${baseUrl.replace(/\/$/, "")}${meetingSeriesEntryUrl(series.id)}`;
}

export function prepareSeriesCalendarDefinition(
  series: SeriesCalendar,
  now: string,
  occurrences: SeriesCalendarOccurrence[],
) {
  const through = series.calendar_through ?? meetingCalendarThrough(series.starts_at, series.timezone, now);
  const instants = occurrences.flatMap((row) => [row.starts_at, row.ends_at, row.recurrence_id]);
  const timezoneStart = new Date(Math.min(Date.parse(series.starts_at), ...instants.map(Date.parse))).toISOString();
  const timezoneThrough = new Date(Math.max(Date.parse(through), ...instants.map(Date.parse))).toISOString();
  return {
    through,
    timezoneComponent: buildCalendarTimezone(series.timezone, timezoneStart, timezoneThrough),
    regularStarts: expandStarts(series.starts_at, series.timezone, series.recurrence_rule, through, 50_000),
  };
}

/** A bounded recurrence rule with IANA timezone observances and explicit occurrence exceptions. */
export function buildSeriesCalendarPayload(
  series: SeriesCalendar,
  occurrences: SeriesCalendarOccurrence[],
  options: {
    baseUrl: string;
    attendeeEmail?: string;
    organizerEmail?: string;
    cancelled: boolean;
    now: string;
    published?: boolean;
    joinUrl?: string;
    definition?: ReturnType<typeof prepareSeriesCalendarDefinition>;
  },
): CalendarPayload {
  const calendar = new ICAL.Component("vcalendar");
  const method = options.cancelled ? "CANCEL" : "REQUEST";
  calendar.addPropertyWithValue("version", "2.0");
  calendar.addPropertyWithValue("prodid", "-//PKI Consortium//Group Meetings//EN");
  calendar.addPropertyWithValue("calscale", "GREGORIAN");
  if (!options.published) calendar.addPropertyWithValue("method", method);
  const { timezoneComponent, regularStarts, through } =
    options.definition ?? prepareSeriesCalendarDefinition(series, options.now, occurrences);
  calendar.addSubcomponent(new ICAL.Component(JSON.parse(JSON.stringify(timezoneComponent.toJSON()))));
  const zone = new ICAL.Timezone({ component: timezoneComponent, tzid: series.timezone });
  const local = (instant: string) =>
    ICAL.Time.fromData({ ...zonedDateTimeParts(new Date(instant), series.timezone), isDate: false }, zone);
  function dateProperty(item: ICAL.Component, name: string, instant: string) {
    const property = item.addPropertyWithValue(name, local(instant));
    property.setParameter("tzid", series.timezone);
  }
  const utc = (instant: string) => ICAL.Time.fromJSDate(new Date(instant), true);
  const uid = `${series.id}@pkic.org`;
  const url = options.joinUrl ?? seriesCalendarUrl(options.baseUrl, series);
  function event(startsAt: string, endsAt: string, location: string | null, cancelled: boolean) {
    const item = new ICAL.Component("vevent");
    item.addPropertyWithValue("uid", uid);
    item.addPropertyWithValue("sequence", series.calendar_revision);
    item.addPropertyWithValue("dtstamp", utc(options.now));
    dateProperty(item, "dtstart", startsAt);
    dateProperty(item, "dtend", endsAt);
    item.addPropertyWithValue("summary", series.event_name);
    item.addPropertyWithValue(
      "description",
      `Open this link to confirm your identity, record your entry, and join the next scheduled occurrence: ${url}\n\n${MEETING_PERSONAL_CALENDAR_NOTICE}`,
    );
    item.addPropertyWithValue("url", url);
    item.addPropertyWithValue("status", cancelled ? "CANCELLED" : "CONFIRMED");
    const publicLocation = outboundMeetingLocation(location);
    if (publicLocation) item.addPropertyWithValue("location", publicLocation);
    if (options.organizerEmail) item.addPropertyWithValue("organizer", `mailto:${options.organizerEmail}`);
    if (options.attendeeEmail) {
      const attendee = item.addPropertyWithValue("attendee", `mailto:${options.attendeeEmail}`);
      attendee.setParameter("role", "REQ-PARTICIPANT");
      attendee.setParameter("partstat", "NEEDS-ACTION");
      attendee.setParameter("rsvp", "TRUE");
    }
    if (!cancelled) {
      const reminder = new ICAL.Component("valarm");
      reminder.addPropertyWithValue("action", "DISPLAY");
      reminder.addPropertyWithValue("description", `Reminder: ${series.event_name}`);
      reminder.addPropertyWithValue("trigger", ICAL.Duration.fromString("-PT15M"));
      item.addSubcomponent(reminder);
    }
    calendar.addSubcomponent(item);
    return item;
  }
  const first = ICAL.Recur.fromString(series.recurrence_rule)
    .iterator(ICAL.Time.fromData({ ...zonedDateTimeParts(new Date(series.starts_at), series.timezone), isDate: false }))
    .next();
  const anchor = first
    ? zonedDateTimeToDate(
        {
          year: first.year,
          month: first.month,
          day: first.day,
          hour: first.hour,
          minute: first.minute,
          second: first.second,
        },
        series.timezone,
      ).toISOString()
    : series.starts_at;
  const master = event(
    anchor,
    new Date(Date.parse(anchor) + series.duration_minutes * 60_000).toISOString(),
    series.location,
    options.cancelled,
  );
  const regular = new Set(regularStarts);
  const rule = ICAL.Recur.fromString(series.recurrence_rule);
  if (rule.count !== null) {
    rule.count = regularStarts.length;
  } else {
    const horizon = utc(through);
    if (!rule.until || rule.until.compare(horizon) > 0) rule.until = horizon;
  }
  if (regularStarts.length) master.addPropertyWithValue("rrule", rule);
  const dates = occurrences.filter((row) => !regular.has(row.recurrence_id)).map((row) => local(row.recurrence_id));
  if (dates.length) {
    const rdate = new ICAL.Property("rdate");
    rdate.setValues(dates);
    rdate.setParameter("tzid", series.timezone);
    master.addProperty(rdate);
  }
  for (const row of occurrences) {
    if (
      row.starts_at === row.recurrence_id &&
      Date.parse(row.ends_at) - Date.parse(row.starts_at) === series.duration_minutes * 60_000 &&
      row.status !== "cancelled" &&
      row.location === series.location
    )
      continue;
    const exception = event(row.starts_at, row.ends_at, row.location, options.cancelled || row.status === "cancelled");
    dateProperty(exception, "recurrence-id", row.recurrence_id);
  }
  const content = `${calendar.toString()}\r\n`;
  return {
    eventId: series.event_id,
    icsUid: uid,
    icsFiles: [{ uid, filename: meetingCalendarFilename(series.event_name, series.owner_group_slug), content }],
    inlineContent: content,
    method,
  };
}
