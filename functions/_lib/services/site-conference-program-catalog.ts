import { approvedEventAgendaForRoute } from "./site-published-event-agendas";
import type { SitePublicationSnapshot } from "../../../assets/shared/schemas/site-publication";
import { applyApprovedAgenda } from "./site-approved-agenda";
import type { ContentDocument } from "./site-documents";
import { publishedConferenceProgram } from "./site-conference-program";

/** Catalog authored events that still publish their historical calendar. */
export function createSiteConferencePrograms(
  documents: readonly ContentDocument[],
  assetUrls: (sourcePath: string, pattern: string) => string[],
) {
  return (publication?: SitePublicationSnapshot) =>
    documents
      .filter(
        (document) =>
          document.data.draft !== true && document.data.data && document.data.outputs?.includes("event-agenda"),
      )
      .map((document) => ({
        route: document.route,
        title: document.data.title ?? "Conference",
        updatedAt: new Date(document.data.lastmod ?? document.data.date ?? "1970-01-01T00:00:00.000Z").toISOString(),
        outputs: document.data.outputs ?? [],
        program: applyApprovedAgenda(
          publishedConferenceProgram(document.data.data, (pattern) => assetUrls(document.sourcePath, pattern)),
          approvedEventAgendaForRoute(publication, document.route),
        ),
      }));
}
