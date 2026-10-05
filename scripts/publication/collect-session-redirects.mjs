import { publishedSessionRoute } from "../../assets/shared/session-public-route.ts";

/** Archived session aliases belong to the same immutable release as their target pages. */
export function collectSessionRedirects(snapshot, files) {
  const owned = new Set(
    files.filter((file) => file.endsWith("/index.html")).map((file) => `/${file.slice(0, -"index.html".length)}`),
  );
  const redirects = new Map();
  for (const agenda of Object.values(snapshot.eventAgendas ?? {})) {
    for (const session of agenda.occurrences) {
      const to = publishedSessionRoute(agenda.eventSlug, session);
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
  return [...redirects.values()].sort((a, b) => a.from.localeCompare(b.from));
}
