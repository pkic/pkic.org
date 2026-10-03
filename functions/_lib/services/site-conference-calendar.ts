import ICAL from "ical.js";
import { conferenceLocation } from "./site-conference-location";
import type { ConferenceProgram } from "../../../assets/shared/schemas/conference-program";
import { siteContentSlug } from "../../../assets/shared/site-content-slug";

/** Publish the same session windows as the visible agenda, with stable legacy UIDs. */
export function conferenceAgendaCalendar(program: ConferenceProgram, eventUrl: string, updatedAt: string): string {
  const calendar = new ICAL.Component("vcalendar");
  calendar.addPropertyWithValue("version", "2.0");
  calendar.addPropertyWithValue("prodid", "-//PKI Consortium//Conference Agenda//EN");
  calendar.addPropertyWithValue("calscale", "GREGORIAN");
  calendar.addPropertyWithValue("method", "PUBLISH");
  calendar.addPropertyWithValue("x-wr-calname", program.name);
  calendar.addPropertyWithValue("x-wr-timezone", program.timezone);
  const utc = (instant: string) => ICAL.Time.fromJSDate(new Date(instant), true);
  for (const [date, slots] of Object.entries(program.agenda)) {
    for (const slot of slots) {
      for (const session of slot.sessions) {
        const item = new ICAL.Component("vevent");
        item.addPropertyWithValue(
          "uid",
          session.id
            ? `agenda-${session.id}@ics.pkic.org`
            : `${siteContentSlug(`${session.locations.join(" ")}-${date}-${slot.time}`)}@ics.pkic.org`,
        );
        item.addPropertyWithValue("dtstamp", utc(updatedAt));
        item.addPropertyWithValue("dtstart", utc(slot.startsAt));
        if (session.endsAt) item.addPropertyWithValue("dtend", utc(session.endsAt));
        item.addPropertyWithValue("summary", session.title);
        item.addPropertyWithValue(
          "description",
          [
            program.draft ? "This is a preliminary agenda and is subject to change." : "",
            session.description ?? "",
            session.speakers.length ? `Speakers: ${session.speakers.join(", ")}` : "",
          ]
            .filter(Boolean)
            .join("\n\n"),
        );
        const locations = session.locations.map((id) => conferenceLocation(program, date, id));
        if (locations.length) {
          item.addPropertyWithValue("location", locations.map((location) => location.name).join(", "));
          const categories = item.addPropertyWithValue("categories", locations[0]!.name);
          categories.setValues([locations[0]!.name, ...(session.track ? [session.track] : [])]);
          if (locations[0]!.color) {
            item.addPropertyWithValue("color", locations[0]!.color);
            item.addPropertyWithValue("x-apple-calendar-color", locations[0]!.color);
          }
          for (const location of locations) {
            if (!location.livestream) continue;
            const conference = new ICAL.Property("conference");
            conference.resetType("uri");
            conference.setValue(location.livestream);
            conference.setParameter("label", `${location.name} livestream`);
            conference.setParameter("feature", "AUDIO,VIDEO,SCREEN");
            item.addProperty(conference);
          }
          const livestream = locations.find((location) => location.livestream)?.livestream;
          if (livestream) {
            item.addPropertyWithValue("x-microsoft-onlinemeetingconflink", livestream);
            item.addPropertyWithValue("x-google-conference", livestream);
          }
        }
        item.addPropertyWithValue("url", eventUrl);
        calendar.addSubcomponent(item);
      }
    }
  }
  return `${calendar.toString()}\r\n`;
}
