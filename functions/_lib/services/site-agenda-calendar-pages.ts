import type { SitePublicationSnapshot } from "../../../assets/shared/schemas/site-publication";
import { publishedEventAgendas, approvedEventProgram } from "./site-published-event-agendas";
import { applyApprovedAgenda } from "./site-approved-agenda";
import { conferenceAgendaCalendar } from "./site-conference-calendar";
import { publicAgendaCalendar, publicSessionCalendarPath } from "./site-public-agenda-calendar";

/** Build-only pages preserve current archival start-only output alongside native lifecycle entries. */
export function publicAgendaCalendarPages(publication: SitePublicationSnapshot) {
  const current = new Map(publishedEventAgendas(publication).map(({ snapshot, route }) => [route, snapshot]));
  const pages = new Map(
    [...current].map(([route, snapshot]) => [
      route,
      {
        path: `${route}calendar.ics`,
        content: conferenceAgendaCalendar(
          approvedEventProgram(snapshot),
          new URL(route, "https://pkic.org").href,
          snapshot.approvedAt ?? "1970-01-01T00:00:00.000Z",
        ),
      },
    ]),
  );
  for (const calendar of Object.values(publication.eventAgendaCalendars ?? {})) {
    const snapshot = current.get(calendar.agendaPath);
    pages.set(calendar.agendaPath, {
      path: `${calendar.agendaPath}calendar.ics`,
      content: publicAgendaCalendar(calendar, "https://pkic.org", {
        current: snapshot
          ? {
              program: approvedEventProgram(snapshot),
              updatedAt: snapshot.approvedAt ?? "1970-01-01T00:00:00.000Z",
              eventUrl: new URL(calendar.agendaPath, "https://pkic.org").href,
            }
          : undefined,
      }),
    });
  }
  return [...pages.values()];
}
export function publicSessionCalendarPages(publication: SitePublicationSnapshot) {
  return Object.values(publication.eventAgendaCalendars ?? {}).flatMap((calendar) =>
    calendar.entries.map((entry) => ({
      path: publicSessionCalendarPath(calendar.agendaPath, entry.occurrenceId),
      content: publicAgendaCalendar(calendar, "https://pkic.org", { occurrenceId: entry.occurrenceId }),
    })),
  );
}

/** Both known legacy and canonical URLs honor a retained withdrawal, including an empty expired feed. */
export function publicConferenceAgendaCalendar(
  publication: SitePublicationSnapshot,
  event: { route: string; program: Parameters<typeof conferenceAgendaCalendar>[0]; updatedAt: string },
) {
  const agendaPath = `${event.route}agenda/`;
  const calendars = Object.values(publication.eventAgendaCalendars ?? {}).filter(
    (calendar) => calendar.agendaPath === agendaPath,
  );
  const current = publishedEventAgendas(publication).filter(({ route }) => route === agendaPath);
  if (calendars.length > 1 || current.length > 1) throw new Error("PUBLIC_CALENDAR_ROUTE_CONFLICT");
  const calendar = calendars[0];
  const snapshot = current[0]?.snapshot;
  const program = applyApprovedAgenda(event.program, snapshot);
  return calendar
    ? publicAgendaCalendar(calendar, "https://pkic.org", {
        current: snapshot
          ? { program, updatedAt: snapshot.approvedAt ?? event.updatedAt, eventUrl: `https://pkic.org${event.route}` }
          : undefined,
      })
    : conferenceAgendaCalendar(program, `https://pkic.org${event.route}`, event.updatedAt);
}
