import { publicationAuthoredAgendaRoutes } from "../../../assets/shared/publication-agenda-routes";
import type { AgendaSnapshot } from "../../../assets/shared/schemas/event-agenda";
import type { SitePublicationSnapshot } from "../../../assets/shared/schemas/site-publication";
import { publishedConferenceProgram } from "./site-conference-program";
import { applyApprovedAgenda } from "./site-approved-agenda";

/** A build-only catalog also gives portal-created meetings a static public agenda. */
export function publishedEventAgendas(publication: SitePublicationSnapshot) {
  return Object.values(publication.eventAgendas ?? {}).map((snapshot) => ({
    snapshot,
    route: snapshot.publicAgendaPath ?? `/events/${encodeURIComponent(snapshot.eventSlug)}/agenda/`,
  }));
}
export function approvedEventProgram(snapshot: AgendaSnapshot) {
  return applyApprovedAgenda(
    publishedConferenceProgram(
      { name: snapshot.eventName ?? "Event agenda", timezone: snapshot.timeZone, agenda: {} },
      () => [],
    ),
    snapshot,
  );
}

/** Links exist only for an approved public feed retained in the publication catalog. */
export function publishedAgendaCalendarLinks(publication: SitePublicationSnapshot, snapshot: AgendaSnapshot) {
  const calendar = publication.eventAgendaCalendars?.[snapshot.eventSlug];
  if (!snapshot.calendarPublic || !calendar || calendar.agendaPath !== snapshot.publicAgendaPath) return undefined;
  const downloadHref = `${calendar.agendaPath}calendar.ics`;
  return { downloadHref, subscribeHref: new URL(downloadHref, "https://pkic.org").href.replace(/^https?:/, "webcal:") };
}

/** Apply a publication only to its canonical agenda or explicitly owned event root. */
export function approvedEventAgendaForRoute(
  publication: SitePublicationSnapshot | undefined,
  route: string,
  eventRoute?: string,
): AgendaSnapshot | undefined {
  if (!publication) return undefined;
  const originals = publicationAuthoredAgendaRoutes(publication).filter(
    (owner) => owner.route === (eventRoute ?? route),
  );
  const owners = publishedEventAgendas(publication).filter(
    (entry) =>
      route === entry.route ||
      `${eventRoute ?? route}agenda/` === entry.route ||
      originals.some((owner) => owner.eventSlug === entry.snapshot.eventSlug),
  );
  if (owners.length > 1) throw new Error(`Ambiguous approved agenda ownership for route ${route}`);
  return owners[0]?.snapshot;
}
