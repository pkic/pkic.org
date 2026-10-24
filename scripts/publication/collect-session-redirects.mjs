import { publicationAuthoredAgendaRoutes } from "../../assets/shared/publication-agenda-routes.ts";
import { publishedSessionRoute } from "../../assets/shared/public-agenda-pages.ts";
import {
  memberPageRedirects,
  sessionPageRedirects,
  personProfileRedirects,
} from "../../functions/_lib/services/site-session-history.ts";

/** Archived session and speaker profile aliases belong to the same immutable release as their target pages. */
export function collectSessionRedirects(snapshot, files) {
  const owned = new Set(
    files.filter((file) => file.endsWith("/index.html")).map((file) => `/${file.slice(0, -"index.html".length)}`),
  );
  const redirects = new Map();
  for (const agenda of Object.values(snapshot.eventAgendas ?? {})) {
    for (const session of agenda.occurrences) {
      const to = publishedSessionRoute(agenda, session);
      if (!to || !owned.has(to)) continue;
      for (const from of session.history?.legacyPaths ?? []) {
        if (
          !from.startsWith("/events/") ||
          from.includes("?") ||
          from.includes("#") ||
          from.includes("\\") ||
          from.split("/").includes("..")
        )
          throw new Error("Session archive aliases must be event page paths without queries or fragments");
        if (from === to) continue;
        if (owned.has(from)) throw new Error(`Session archive alias collides with a generated page: ${from}`);
        if (redirects.has(from) && redirects.get(from).to !== to)
          throw new Error(`Session archive alias has multiple destinations: ${from}`);
        redirects.set(from, { from, to, status: 301 });
      }
    }
  }
  // A session's ID and former addresses, a person's former profile addresses, and a merged organization's
  // member page lead to the page this release renders.
  for (const redirect of [
    ...sessionPageRedirects(snapshot),
    ...personProfileRedirects(snapshot),
    ...memberPageRedirects(snapshot),
  ]) {
    if (!owned.has(redirect.to)) continue;
    if (owned.has(redirect.from))
      throw new Error(`Page address alias collides with a generated page: ${redirect.from}`);
    if (redirects.has(redirect.from) && redirects.get(redirect.from).to !== redirect.to)
      throw new Error(`Page address alias has multiple destinations: ${redirect.from}`);
    redirects.set(redirect.from, redirect);
  }
  // Preserve a dedicated generated agenda page; otherwise the authored event page embeds its agenda.
  for (const owner of publicationAuthoredAgendaRoutes(snapshot)) {
    const agenda = snapshot.eventAgendas[owner.eventSlug];
    const natural = `${owner.route}agenda/`;
    const to = owned.has(natural) ? natural : owner.route;
    if (!owned.has(to)) throw new Error(`Authored agenda alias target was not generated: ${to}`);
    const canonical = agenda.publicAgendaPath ?? `/events/${encodeURIComponent(agenda.eventSlug)}/agenda/`;
    for (const from of new Set([natural, canonical])) {
      if (from === to) continue;
      if (owned.has(from)) throw new Error(`Authored agenda alias collides with a generated page: ${from}`);
      const previous = redirects.get(from);
      if (previous && previous.to !== to) throw new Error(`Authored agenda alias has multiple destinations: ${from}`);
      redirects.set(from, { from, to, status: 301 });
    }
  }
  return [...redirects.values()].sort((a, b) => a.from.localeCompare(b.from));
}
