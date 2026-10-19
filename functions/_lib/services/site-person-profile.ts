/**
 * One person's professional profile, projected from canonical sources: the
 * appearances approved on published agendas and the contributions read by
 * `people/published-person`. The static page and the owner's portal view
 * both call `personProfile`; only where the sources come from differs.
 */
import { agendaSpeakerContent } from "../../../assets/shared/public-agenda-content";
import { agendaOccurrenceRoomIds } from "../../../assets/shared/event-agenda-rooms";
import { memberProfileHref } from "../../../assets/shared/member-profile-url";
import { publicationAgendaPage } from "../../../assets/shared/publication-agenda-routes";
import { publicSessionTiming } from "../../../assets/shared/session-public-timing";
import { publicPersonIdentities, publishedContributorRoute } from "../../../assets/shared/person-profile-policy";
import type { AgendaSnapshot } from "../../../assets/shared/schemas/event-agenda";
import type { ContentAgendaSpeaker } from "../../../assets/shared/site-agenda";
import type { SitePublicationSnapshot } from "../../../assets/shared/schemas/site-publication";
import {
  personProfileSchema,
  type PersonProfile,
  type PersonProfileEvent,
  type PersonProfileIdentity,
  type PublishedPerson,
} from "../../../assets/shared/schemas/person-profile";
import type { PublishedPersonPage, PublishedSpeaker } from "./site-session-history";

type Appearance = PublishedSpeaker["appearances"][number];

/** Where the profile links: pages the same build or live data says exist. */
export interface PersonProfileLinks {
  /** An organization's member page, only when it is rendered. */
  organizationPage(organizationId: string | null): string | undefined;
  agendaPage(agenda: AgendaSnapshot): string;
  /** Whether an election's page is rendered. */
  votePage(slug: string): boolean;
}

export interface PersonProfileSources {
  userId: string;
  /** The account's own name; shown only until an approved appearance names the person. */
  accountName: string;
  /** The page the build renders for the person, with their appearances most recent first; absent when it renders none. */
  page: PublishedPersonPage | undefined;
  person: PublishedPerson | undefined;
  links: PersonProfileLinks;
}

/** One approved appearance as the agenda credits it, with organization pages linked where they are rendered. */
export function appearanceContent(links: PersonProfileLinks, item: Appearance): ContentAgendaSpeaker {
  const content = agendaSpeakerContent(item.session, item.credit, item.agenda.speakerOrganizations);
  // agendaSpeakerContent maps an appearance's affiliations one to one and in order.
  const affiliations = content.affiliations?.map((affiliation, index) => {
    const href = links.organizationPage(item.credit.affiliations[index]?.organizationId ?? null);
    return affiliation.organization && href
      ? { ...affiliation, organization: { ...affiliation.organization, href } }
      : affiliation;
  });
  return { ...content, ...(affiliations ? { affiliations } : {}) };
}

function appearanceEvents(links: PersonProfileLinks, page: PublishedPersonPage | undefined): PersonProfileEvent[] {
  const events = new Map<string, PersonProfileEvent>();
  for (const item of page?.appearances ?? []) {
    const content = appearanceContent(links, item);
    const event = events.get(item.agenda.eventSlug) ?? {
      eventName: item.agenda.eventName ?? item.agenda.eventSlug,
      agendaPage: links.agendaPage(item.agenda),
      timeZone: item.agenda.timeZone,
      clockCity: item.agenda.clockCity ?? null,
      sessions: [],
    };
    event.sessions.push({
      id: item.session.id,
      title: item.session.title,
      startsAt: publicSessionTiming(item.session)!.startAt,
      timeZone: item.agenda.timeZone,
      clockCity: item.agenda.clockCity ?? null,
      room: agendaOccurrenceRoomIds(item.session)
        .map((id) => item.agenda.rooms.find((room) => room.id === id)?.name)
        .filter(Boolean)
        .join(" / "),
      url: item.route,
      moderator: Boolean(content.moderator),
      ...(content.roleLabel ? { roleLabel: content.roleLabel } : {}),
      ...(content.affiliations ? { affiliations: content.affiliations } : {}),
    });
    events.set(item.agenda.eventSlug, event);
  }
  for (const event of events.values()) event.sessions.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  return [...events.values()];
}

function identities(links: PersonProfileLinks, person: PublishedPerson | undefined): PersonProfileIdentity[] {
  return (person?.identities ?? []).map(({ organizationId, organizationName, organizationLogoUrl, ...identity }) => {
    const href = links.organizationPage(organizationId);
    return {
      ...identity,
      organization: organizationName
        ? {
            name: organizationName,
            ...(organizationLogoUrl ? { logoSrc: organizationLogoUrl } : {}),
            ...(href ? { href } : {}),
          }
        : null,
    };
  });
}

/** A capacity in words, as the person would introduce it: "Chair at PKI Consortium". */
function capacity(title: string | null | undefined, organization: string | null | undefined): string | null {
  if (title && organization) return `${title} at ${organization}`;
  return title || organization || null;
}

/** The leading public capacity: the first shown identity that is current, else the latest approved credit. */
function headline(shown: readonly PersonProfileIdentity[], latest: ContentAgendaSpeaker | undefined) {
  const current = shown.find((identity) => identity.endedAt === null && (identity.title || identity.organization));
  if (current) return capacity(current.title, current.organization?.name);
  const primary = latest?.affiliations?.[0];
  return capacity(primary?.title, primary?.organization?.name);
}

/** The profile, as its sources allow. A hidden identity in the sources is kept, marked, for its owner. */
export function personProfile(sources: PersonProfileSources): PersonProfile {
  const latestAppearance = sources.page?.appearances[0];
  const latest = latestAppearance ? appearanceContent(sources.links, latestAppearance) : undefined;
  const allIdentities = identities(sources.links, sources.person);
  return personProfileSchema.parse({
    userId: sources.userId,
    name: sources.page?.name ?? sources.accountName,
    route:
      sources.page?.route ??
      (sources.person ? publishedContributorRoute(sources.person, sources.links.votePage) : undefined) ??
      null,
    imageSrc: latest?.imageSrc ?? null,
    headline: headline(publicPersonIdentities(allIdentities), latest),
    biographyMarkdown: latest?.bioMarkdown ?? "",
    links: latest?.links ?? [],
    identities: allIdentities,
    events: appearanceEvents(sources.links, sources.page),
    groups: sources.person?.groups ?? [],
    candidacies: (sources.person?.candidacies ?? []).filter((candidacy) => sources.links.votePage(candidacy.voteSlug)),
  });
}

/** Links to pages this publication renders: member pages, agenda pages and election pages. */
export function publicationProfileLinks(publication: SitePublicationSnapshot): PersonProfileLinks {
  const members = new Map(publication.members.map((member) => [member.id, memberProfileHref(member)]));
  const votes = new Set(publication.votes.map((vote) => vote.slug));
  return {
    organizationPage: (organizationId) => (organizationId ? members.get(organizationId) : undefined),
    agendaPage: (agenda) => publicationAgendaPage(publication, agenda),
    votePage: (slug) => votes.has(slug),
  };
}

/** The static page of one person the publication renders a profile for. */
export function publishedPersonProfile(publication: SitePublicationSnapshot, page: PublishedPersonPage): PersonProfile {
  return personProfile({
    userId: page.userId,
    accountName: page.name,
    page,
    person: publication.people?.[page.userId],
    links: publicationProfileLinks(publication),
  });
}
