import type { AgendaSnapshot } from "./schemas/event-agenda";
import { publicationAuthoredAgendaRoutesSchema } from "./schemas/site-publication-agenda-routes";

type AgendaRoutePublication = {
  eventAgendas?: Record<string, AgendaSnapshot>;
  authoredAgendaRoutes?: unknown;
};
/** The same native source-owned map drives page overlays, program outputs and static redirects. */
export function publicationAuthoredAgendaRoutes(publication: AgendaRoutePublication) {
  const owners = publicationAuthoredAgendaRoutesSchema.parse(publication.authoredAgendaRoutes ?? []);
  const paths = new Map<string, string>();
  const sources = new Map<string, string>();
  const unique = new Map<string, (typeof owners)[number]>();
  for (const owner of owners) {
    const agenda = publication.eventAgendas?.[owner.eventSlug];
    if (!agenda || agenda.eventSlug !== owner.eventSlug)
      throw new Error("Authored agenda route lacks its approved agenda");
    const identity = JSON.stringify(owner);
    for (const [map, key] of [
      [paths, owner.route],
      [sources, owner.sourcePath],
    ] as const) {
      const previous = map.get(key);
      if (previous && previous !== identity) throw new Error("Authored agenda route has multiple source owners");
      map.set(key, identity);
    }
    for (const other of Object.values(publication.eventAgendas ?? {})) {
      const canonical = other.publicAgendaPath ?? `/events/${encodeURIComponent(other.eventSlug)}/agenda/`;
      if (other.eventSlug !== owner.eventSlug && `${owner.route}agenda/` === canonical)
        throw new Error("Authored agenda root collides with another canonical agenda");
    }
    unique.set(JSON.stringify(owner), owner);
  }
  return [...unique.values()].sort((a, b) => a.route.localeCompare(b.route));
}

/**
 * An authored event page that embeds its agenda stays the public agenda page, as in
 * production; the generated standalone page is only for events without one.
 */
export function publicationAgendaPage(publication: AgendaRoutePublication, agenda: AgendaSnapshot) {
  return (
    publicationAuthoredAgendaRoutes(publication).find((owner) => owner.eventSlug === agenda.eventSlug)?.route ??
    agenda.publicAgendaPath ??
    `/events/${encodeURIComponent(agenda.eventSlug)}/agenda/`
  );
}

/** Exact agenda child pages; unknown days and arbitrary descendants are never publication routes. */
export function publicAgendaChildRoutes(basePath: string, dates: readonly string[]) {
  if (
    !basePath.startsWith("/events/") ||
    !basePath.endsWith("/agenda/") ||
    /[?#\\\s\p{Cc}]/u.test(basePath) ||
    new URL(basePath, "https://pkic.org").pathname !== basePath
  )
    throw new Error("Agenda children require an exact public agenda base");
  const days = [...new Set(dates)].sort();
  if (
    days.length > 366 ||
    days.some(
      (date) =>
        !/^\d{4}-\d{2}-\d{2}$/u.test(date) || new Date(`${date}T00:00:00.000Z`).toISOString().slice(0, 10) !== date,
    )
  )
    throw new Error("Agenda children require bounded calendar dates");
  return [...days, "speakers"].map((initialDay) => ({
    route: `${basePath}${initialDay}/`,
    agendaBasePath: basePath,
    initialDay,
  }));
}
