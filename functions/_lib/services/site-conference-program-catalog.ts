import { conferenceDisplaySponsorSelection } from "../../../assets/shared/conference-display-policy";
import type { ContentDocument } from "./site-documents";
import { publishedConferenceProgram } from "./site-conference-program";

/** Honor authored output selection; display-only pages stay out of discovery. */
export function createSiteConferencePrograms(
  documents: readonly ContentDocument[],
  assetUrls: (sourcePath: string, pattern: string) => string[],
) {
  return () =>
    documents
      .filter(
        (document) =>
          document.data.draft !== true &&
          document.data.data &&
          document.data.outputs?.some((output) => output.startsWith("event-")),
      )
      .map((document) => ({
        route: document.route,
        title: document.data.title ?? "Conference",
        updatedAt: new Date(document.data.lastmod ?? document.data.date ?? "1970-01-01T00:00:00.000Z").toISOString(),
        outputs: document.data.outputs ?? [],
        sponsorSelection: conferenceDisplaySponsorSelection(document.data.params?.sponsoring),
        program: publishedConferenceProgram(document.data.data, (pattern) => assetUrls(document.sourcePath, pattern)),
      }));
}
