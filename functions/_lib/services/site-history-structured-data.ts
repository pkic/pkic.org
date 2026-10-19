import { publicSessionTiming } from "../../../assets/shared/session-public-timing";
import { publicationAgendaPage } from "../../../assets/shared/publication-agenda-routes";
import type { SitePublicationSnapshot } from "../../../assets/shared/schemas/site-publication";
import type { PublishedPersonPage, PublishedSession } from "./site-session-history";
import type { PersonProfile } from "../../../assets/shared/schemas/person-profile";
import { formatEventPlace, type EventPlace } from "../../../assets/shared/event-place";

/**
 * Where the event takes place, as schema.org reads it: a `Place` whose
 * `PostalAddress` carries the city and the ISO country code. The place's name
 * is the same English line every other surface composes.
 */
export function eventPlaceStructuredData(place: EventPlace | undefined) {
  const name = place ? formatEventPlace(place, "en") : null;
  if (!place || !name) return undefined;
  return {
    "@type": "Place",
    name,
    address: {
      "@type": "PostalAddress",
      ...(place.city ? { addressLocality: place.city } : {}),
      ...(place.country ? { addressCountry: place.country } : {}),
    },
  };
}

/** The event a session belongs to, addressed by the agenda page the same build renders. */
function superEvent(publication: SitePublicationSnapshot, item: PublishedSession, origin: string) {
  const location = eventPlaceStructuredData(item.agenda.eventPlace);
  return {
    "@type": "Event",
    name: item.agenda.eventName ?? item.agenda.eventSlug,
    url: new URL(publicationAgendaPage(publication, item.agenda), origin).href,
    ...(location ? { location } : {}),
  };
}

function sessionEvent(publication: SitePublicationSnapshot, item: PublishedSession, origin: string) {
  const url = new URL(item.route, origin).href;
  const timing = publicSessionTiming(item.session);
  const room = item.session.roomId ? item.agenda.rooms.find((value) => value.id === item.session.roomId) : undefined;
  return {
    "@type": "Event",
    "@id": `${url}#session`,
    url,
    name: item.session.title,
    startDate: timing?.startAt,
    ...(timing?.endAt ? { endDate: timing.endAt } : {}),
    ...(room ? { location: { "@type": "Place", name: room.name } } : {}),
    superEvent: superEvent(publication, item, origin),
  };
}

/** Only approved, publicly discoverable archive entries may be passed to these build-only helpers. */
export function sessionHistoryStructuredData(
  publication: SitePublicationSnapshot,
  item: PublishedSession,
  origin: string,
) {
  const event = sessionEvent(publication, item, origin);
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        ...event,
        description: item.session.description,
        performer: item.credits.map(({ credit, personPath }) => ({
          "@type": "Person",
          name: credit.displayName,
          ...(personPath ? { url: new URL(personPath, origin).href } : {}),
        })),
      },
      ...item.materials
        .filter((material) => material.kind === "recording")
        .map((material) => ({
          "@type": "VideoObject",
          "@id": `${event.url}#recording-${encodeURIComponent(material.id)}`,
          name: material.title,
          description: item.session.description,
          url: new URL(material.url, origin).href,
          ...(material.approvedAt ? { datePublished: material.approvedAt } : {}),
          isPartOf: { "@id": `${event.url}#session` },
        })),
    ],
  };
}

/** A profile page about one person, naming every session they appeared in, if any, and the event it belonged to. */
export function personProfileStructuredData(
  publication: SitePublicationSnapshot,
  person: PublishedPersonPage,
  profile: PersonProfile,
  origin: string,
) {
  const url = new URL(person.route, origin).href;
  // The capacities the profile shows publicly and that the person holds now.
  const current = profile.identities.filter((identity) => identity.visibility !== "hidden" && !identity.endedAt);
  const titles = current.flatMap((identity) => (identity.title ? [identity.title] : []));
  const organization = (value: { name: string; href?: string }) => ({
    "@type": "Organization",
    name: value.name,
    ...(value.href ? { url: new URL(value.href, origin).href } : {}),
  });
  const organizations = current.flatMap((identity) =>
    identity.organization ? [organization(identity.organization)] : [],
  );
  const latest = profile.events[0]?.sessions.at(-1)?.affiliations ?? [];
  const fallbackTitles = latest.flatMap((affiliation) => (affiliation.title ? [affiliation.title] : []));
  const fallbackOrganizations = latest.flatMap((affiliation) =>
    affiliation.organization ? [organization(affiliation.organization)] : [],
  );
  const jobTitles = titles.length ? titles : fallbackTitles;
  const worksFor = organizations.length ? organizations : fallbackOrganizations;
  return {
    "@context": "https://schema.org",
    "@type": "ProfilePage",
    "@id": url,
    url,
    mainEntity: {
      "@type": "Person",
      "@id": `${url}#person`,
      name: profile.name,
      url,
      ...(jobTitles.length ? { jobTitle: jobTitles.length === 1 ? jobTitles[0] : jobTitles } : {}),
      ...(worksFor.length ? { affiliation: worksFor, worksFor } : {}),
      ...(profile.imageSrc ? { image: new URL(profile.imageSrc, origin).href } : {}),
      ...(profile.links.length ? { sameAs: profile.links } : {}),
      ...(profile.groups.length
        ? {
            memberOf: [...new Set(profile.groups.map((group) => group.groupName))].map((name) => ({
              "@type": "Organization",
              name,
            })),
          }
        : {}),
      ...(person.appearances.length
        ? { performerIn: person.appearances.map((item) => sessionEvent(publication, item, origin)) }
        : {}),
    },
  };
}
