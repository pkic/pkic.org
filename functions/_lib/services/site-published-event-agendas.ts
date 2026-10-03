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
