import ICAL from "ical.js";
import type { ConferenceProgram } from "../../../assets/shared/schemas/conference-program";
import type { PublicAgendaCalendar } from "../../../assets/shared/schemas/site-agenda-calendar";
import { agendaOccurrenceCalendarUid } from "../../../assets/shared/event-agenda-calendar-identity";
import { conferenceAgendaCalendar, conferenceCalendarComponent } from "./site-conference-calendar";

/** Static public subscription bytes; a one-session download uses the same UID and sequence. */
export function publicAgendaCalendar(
  calendar: PublicAgendaCalendar,
  origin: string,
  options: {
    occurrenceId?: string;
    current?: { program: ConferenceProgram; updatedAt: string; eventUrl: string };
  } = {},
) {
  const component = conferenceCalendarComponent(calendar.name, calendar.timeZone);
  const current = options.current
    ? new ICAL.Component(
        ICAL.parse(
          conferenceAgendaCalendar(options.current.program, options.current.eventUrl, options.current.updatedAt),
        ),
      ).getAllSubcomponents("vevent")
    : [];
  const currentByUid = new Map<string, ICAL.Component>();
  for (const item of current) {
    const uid = String(item.getFirstPropertyValue("uid"));
    if (currentByUid.has(uid)) throw new Error("PUBLIC_CALENDAR_OCCURRENCE_CONFLICT");
    currentByUid.set(uid, item);
  }
  const claimed = new Set(calendar.entries.map((entry) => agendaOccurrenceCalendarUid(entry.occurrenceId)));
  const utc = (instant: string) => ICAL.Time.fromJSDate(new Date(instant), true);
  for (const entry of calendar.entries) {
    if (options.occurrenceId !== undefined && entry.occurrenceId !== options.occurrenceId) continue;
    const item = new ICAL.Component("vevent");
    item.addPropertyWithValue("uid", agendaOccurrenceCalendarUid(entry.occurrenceId));
    item.addPropertyWithValue("sequence", entry.sequence);
    item.addPropertyWithValue("dtstamp", utc(entry.updatedAt));
    item.addPropertyWithValue("dtstart", utc(entry.startAt));
    item.addPropertyWithValue("dtend", utc(entry.endAt));
    item.addPropertyWithValue("status", entry.status === "canceled" ? "CANCELLED" : "CONFIRMED");
    item.addPropertyWithValue("summary", entry.status === "canceled" ? "Canceled session" : entry.title);
    if (entry.status === "confirmed") {
      item.addPropertyWithValue(
        "description",
        [entry.description, entry.speakers.length ? `Speakers: ${entry.speakers.join(", ")}` : ""]
          .filter(Boolean)
          .join("\n\n"),
      );
      if (entry.locations.length) item.addPropertyWithValue("location", entry.locations.join(", "));
      if (entry.locations.length || entry.track) {
        const categories = item.addPropertyWithValue("categories", entry.locations[0] ?? entry.track!);
        categories.setValues([
          ...(entry.locations[0] ? [entry.locations[0]] : []),
          ...(entry.track ? [entry.track] : []),
        ]);
      }
      item.addPropertyWithValue("url", new URL(entry.agendaPath, origin).href);
      const source = currentByUid.get(agendaOccurrenceCalendarUid(entry.occurrenceId));
      for (const name of [
        "color",
        "x-apple-calendar-color",
        "conference",
        "x-microsoft-onlinemeetingconflink",
        "x-google-conference",
      ])
        for (const property of source?.getAllProperties(name) ?? [])
          item.addProperty(new ICAL.Property(structuredClone(property.toJSON())));
    }
    component.addSubcomponent(item);
  }
  // Preserve current archival start-only output, without inventing native intervals or cancellation candidates.
  if (options.occurrenceId === undefined)
    for (const [uid, item] of currentByUid) {
      if (!item.hasProperty("dtend") && !claimed.has(uid)) component.addSubcomponent(item);
    }
  return `${component.toString()}\r\n`;
}

export function publicSessionCalendarPath(agendaPath: string, occurrenceId: string) {
  return `${agendaPath}calendar/${encodeURIComponent(occurrenceId)}.ics`;
}
