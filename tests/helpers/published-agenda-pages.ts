import type { PublicPagesAgenda } from "../../assets/shared/public-agenda-pages";

/** An approved agenda of a public event: the only kind whose sessions and speakers have site pages. */
export function publishedAgendaPages(
  eventSlug: string,
  speakerProfileSlugs: Record<string, string> = {},
): PublicPagesAgenda {
  return {
    eventSlug,
    approvedAt: "2026-10-01T00:00:00.000Z",
    revision: 1,
    publishedRevision: 1,
    publicPages: true,
    speakerProfileSlugs,
  };
}
