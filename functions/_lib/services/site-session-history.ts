import { publicSessionCredits } from "../../../assets/shared/session-public-credits";
import {
  publishedSessionRoute,
  publishedSpeakerProfileRoute,
  sessionPageAddress,
  personProfileRoute,
} from "../../../assets/shared/public-agenda-pages";
import type { SitePublicationSnapshot } from "../../../assets/shared/schemas/site-publication";
import { publicSessionMaterials } from "../../../assets/shared/schemas/event-session-history";
import { publicSessionTiming } from "../../../assets/shared/session-public-timing";
import { publishedContributorRoute } from "../../../assets/shared/person-profile-policy";

/** Build-only discovery. No public request ever queries the live agenda or profiles. */
export function publishedSessionHistory(publication: Pick<SitePublicationSnapshot, "eventAgendas">) {
  return Object.values(publication.eventAgendas ?? {}).flatMap((agenda) =>
    agenda.occurrences.flatMap((session) => {
      const route = publishedSessionRoute(agenda, session);
      if (!route) return [];
      return [
        {
          agenda,
          session,
          route,
          appearances: session.history?.appearances ?? [],
          credits: publicSessionCredits(session).map((credit) => ({
            credit,
            personPath: publishedSpeakerProfileRoute(agenda, session, credit),
          })),
          materials: publicSessionMaterials(session.history?.materials ?? []),
          lastmod: agenda.approvedAt,
        },
      ];
    }),
  );
}
export type PublishedSession = ReturnType<typeof publishedSessionHistory>[number];
type SessionAppearance = PublishedSession["appearances"][number];

/**
 * One site-wide profile per person with an approved public appearance. Every
 * appearance keeps the representation approved for that session, most recent first.
 */
export function publishedSpeakerHistory(publication: Pick<SitePublicationSnapshot, "eventAgendas">) {
  const people = new Map<
    string,
    {
      userId: string;
      slug: string;
      route: string;
      name: string;
      appearances: Array<PublishedSession & { credit: SessionAppearance }>;
    }
  >();
  for (const session of publishedSessionHistory(publication)) {
    for (const credit of session.appearances) {
      const route = publishedSpeakerProfileRoute(session.agenda, session.session, credit);
      const slug = session.agenda.speakerProfileSlugs?.[credit.userId];
      if (!route || !slug) continue;
      const person = people.get(credit.userId) ?? {
        userId: credit.userId,
        slug,
        route,
        name: credit.displayName,
        appearances: [],
      };
      if (route !== person.route) throw new Error(`Speaker ${credit.userId} has two profile addresses in one build`);
      person.appearances.push({ ...session, credit });
      people.set(credit.userId, person);
    }
  }
  const start = (item: PublishedSession) => publicSessionTiming(item.session)?.startAt ?? "";
  return [...people.values()]
    .map((person) => {
      const appearances = person.appearances.sort(
        (a, b) => start(b).localeCompare(start(a)) || a.route.localeCompare(b.route),
      );
      // The page is named as the person most recently approved being credited.
      return { ...person, name: appearances[0]!.credit.displayName, appearances };
    })
    .sort((a, b) => a.name.localeCompare(b.name) || a.slug.localeCompare(b.slug));
}
export type PublishedSpeaker = ReturnType<typeof publishedSpeakerHistory>[number];
/** A person page the build renders; one without an approved appearance has none listed. */
export type PublishedPersonPage = PublishedSpeaker;

/**
 * Every person page the build renders: each speaker's, and the page of each
 * person without an approved appearance whose address and public
 * contributions the shared rule accepts. Such a page carries the account's name.
 */
export function publishedPersonPages(
  publication: Pick<SitePublicationSnapshot, "eventAgendas" | "people" | "votes">,
): PublishedPersonPage[] {
  const pages = new Map<string, PublishedPersonPage>(
    publishedSpeakerHistory(publication).map((person) => [person.userId, person]),
  );
  const votes = new Set(publication.votes.map((vote) => vote.slug));
  for (const [userId, person] of Object.entries(publication.people ?? {})) {
    if (pages.has(userId)) continue;
    const route = publishedContributorRoute(person, (slug) => votes.has(slug));
    if (route && person.slug)
      pages.set(userId, { userId, slug: person.slug, route, name: person.name, appearances: [] });
  }
  return [...pages.values()].sort((a, b) => a.name.localeCompare(b.name) || a.slug.localeCompare(b.slug));
}

export function sessionHistoryRedirects(publication: SitePublicationSnapshot) {
  return publishedSessionHistory(publication).flatMap((session) =>
    (session.session.history?.legacyPaths ?? [])
      .filter((from) => from !== session.route)
      .map((from) => ({ from, to: session.route, status: 301 as const })),
  );
}

/** A former address leads to the person's current page only when this build renders that page. */
export function personProfileRedirects(publication: SitePublicationSnapshot) {
  if (!publication.personProfileRedirects?.length) return [];
  const rendered = new Set(publishedPersonPages(publication).map((person) => person.slug));
  return (publication.personProfileRedirects ?? [])
    .filter((redirect) => rendered.has(redirect.toSlug) && !rendered.has(redirect.fromSlug))
    .map((redirect) => ({
      from: personProfileRoute(redirect.fromSlug),
      to: personProfileRoute(redirect.toSlug),
      status: 301 as const,
    }));
}

/** A merged organization's member page leads to the page of the organization it was merged into. */
export function memberPageRedirects(publication: SitePublicationSnapshot) {
  return (publication.memberPageRedirects ?? []).map((redirect) => ({
    from: `/members/${encodeURIComponent(redirect.fromSlug)}/`,
    to: `/members/${encodeURIComponent(redirect.toSlug)}/`,
    status: 301 as const,
  }));
}

/** A session's ID address and its former readable addresses lead to the page this build renders for it. */
export function sessionPageRedirects(publication: SitePublicationSnapshot) {
  const retired = new Map<string, string[]>();
  for (const redirect of publication.sessionPageRedirects ?? []) {
    const key = `${redirect.eventSlug}\u0000${redirect.occurrenceId}`;
    retired.set(key, [...(retired.get(key) ?? []), redirect.fromSlug]);
  }
  return Object.values(publication.eventAgendas ?? {}).flatMap((agenda) =>
    agenda.occurrences.flatMap((session) => {
      const route = publishedSessionRoute(agenda, session);
      if (!route) return [];
      return [session.id, ...(retired.get(`${agenda.eventSlug}\u0000${session.id}`) ?? [])]
        .map((segment) => sessionPageAddress(agenda.eventSlug, segment))
        .filter((from) => from !== route)
        .map((from) => ({ from, to: route, status: 301 as const }));
    }),
  );
}
