import { canonicalSessionCredits, publicSessionCredits } from "../../../assets/shared/session-public-credits";
import { publishedSessionRoute } from "../../../assets/shared/session-public-route";
import type { SitePublicationSnapshot } from "../../../assets/shared/schemas/site-publication";
import { publicSessionMaterials } from "../../../assets/shared/schemas/event-session-history";

/** Build-only discovery. No public request ever queries the live agenda or profiles. */
export function publishedSessionHistory(publication: SitePublicationSnapshot) {
  return Object.values(publication.eventAgendas ?? {}).flatMap((agenda) =>
    agenda.occurrences
      .filter((session) => publishedSessionRoute(agenda.eventSlug, session) !== undefined)
      .map((session) => ({
        agenda,
        session,
        route: publishedSessionRoute(agenda.eventSlug, session)!,
        appearances: session.history?.appearances ?? [],
        credits: publicSessionCredits(session),
        materials: publicSessionMaterials(session.history?.materials ?? []),
        lastmod: agenda.approvedAt,
      })),
  );
}
export function publishedSpeakerHistory(publication: SitePublicationSnapshot) {
  const people = new Map<
    string,
    { userId: string; name: string; route: string; appearances: ReturnType<typeof publishedSessionHistory> }
  >();
  for (const session of publishedSessionHistory(publication)) {
    const credits = canonicalSessionCredits(session.session);
    for (const credit of credits) {
      const person = people.get(credit.userId) ?? {
        userId: credit.userId,
        name: credit.displayName,
        route: `/people/${encodeURIComponent(credit.userId)}/`,
        appearances: [],
      };
      person.appearances.push(session);
      people.set(credit.userId, person);
    }
  }
  return [...people.values()].sort((a, b) => a.name.localeCompare(b.name));
}
export function sessionHistoryRedirects(publication: SitePublicationSnapshot) {
  return publishedSessionHistory(publication).flatMap((session) =>
    (session.session.history?.legacyPaths ?? [])
      .filter((from) => from !== session.route)
      .map((from) => ({ from, to: session.route, status: 301 as const })),
  );
}
