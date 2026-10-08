import { publicSessionTiming } from "../../../assets/shared/session-public-timing";
import type { publishedSessionHistory, publishedSpeakerHistory } from "./site-session-history";

/** Only approved, publicly discoverable archive entries may be passed to these build-only helpers. */
export function sessionHistoryStructuredData(item: ReturnType<typeof publishedSessionHistory>[number], origin: string) {
  const url = new URL(item.route, origin).href;
  const credits = item.credits;
  const timing = publicSessionTiming(item.session);
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Event",
        "@id": `${url}#session`,
        url,
        name: item.session.title,
        description: item.session.description,
        startDate: timing?.startAt,
        ...(timing?.endAt ? { endDate: timing.endAt } : {}),
        performer: credits.map((credit) => ({
          "@type": "Person",
          name: credit.displayName,
          ...("userId" in credit ? { url: new URL(`/people/${encodeURIComponent(credit.userId)}/`, origin).href } : {}),
        })),
        ...(item.session.roomId && item.agenda.rooms.some((room) => room.id === item.session.roomId)
          ? {
              location: {
                "@type": "Place",
                name: item.agenda.rooms.find((room) => room.id === item.session.roomId)!.name,
              },
            }
          : {}),
      },
      ...item.materials
        .filter((material) => material.kind === "recording")
        .map((material) => ({
          "@type": "VideoObject",
          "@id": `${url}#recording-${encodeURIComponent(material.id)}`,
          name: material.title,
          description: item.session.description,
          url: new URL(material.url, origin).href,
          ...(material.approvedAt ? { datePublished: material.approvedAt } : {}),
          isPartOf: { "@id": `${url}#session` },
        })),
    ],
  };
}
export function speakerHistoryStructuredData(
  person: ReturnType<typeof publishedSpeakerHistory>[number],
  origin: string,
) {
  const url = new URL(person.route, origin).href;
  return {
    "@context": "https://schema.org",
    "@type": "ProfilePage",
    "@id": url,
    url,
    mainEntity: {
      "@type": "Person",
      "@id": `${url}#person`,
      name: person.name,
      subjectOf: person.appearances.map((item) => ({
        "@type": "Event",
        name: item.session.title,
        url: new URL(item.route, origin).href,
      })),
    },
  };
}
