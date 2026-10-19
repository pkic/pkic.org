import { agendaTransferDigest } from "../../../assets/shared/event-agenda-transfer";
import { authoredAgendaSourcesSchema } from "../../../assets/shared/schemas/site-publication-agenda-routes";
import { normalizedContentSourcePath } from "./site-markdown";
import type { ContentDocument } from "./site-documents";

/** Hash the actual parsed authored data with the canonical transfer source codec. */
export async function readAuthoredAgendaSources(documents: readonly ContentDocument[]) {
  return authoredAgendaSourcesSchema.parse(
    await Promise.all(
      documents
        .filter(
          (document) =>
            document.language === "en" &&
            document.data.draft !== true &&
            document.data.data &&
            normalizedContentSourcePath(document.sourcePath).startsWith("events/") &&
            /\/_?index\.md$/u.test(document.sourcePath),
        )
        .map(async (document) => ({
          sourcePath: `content/${normalizedContentSourcePath(document.sourcePath)}`,
          sourceDigest: await agendaTransferDigest(document.data.data),
          route: document.route,
        })),
    ),
  );
}
