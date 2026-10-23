import type { AgendaSnapshot } from "../../../assets/shared/schemas/event-agenda";
import { agendaTransferModeSchema } from "../../../assets/shared/schemas/event-agenda-transfer";
import { agendaTransferModePolicy } from "../../../assets/shared/event-agenda-transfer";
import {
  authoredAgendaSourcesSchema,
  type AuthoredAgendaSource,
  type PublicationAuthoredAgendaRoute,
} from "../../../assets/shared/schemas/site-publication-agenda-routes";
import { readHistoricalOccurrenceSources } from "./event-agenda/historical-mapping-import";
import type { DatabaseLike } from "../types";

/** Only trusted archive imports can own the original authored event-page namespace. */
export async function resolveAuthoredAgendaRouteOwners(
  db: DatabaseLike,
  eventId: string,
  approved: AgendaSnapshot,
  input: readonly AuthoredAgendaSource[],
): Promise<PublicationAuthoredAgendaRoute[]> {
  const authored = authoredAgendaSourcesSchema.parse(input);
  if (!authored.length) return [];
  const sources = await readHistoricalOccurrenceSources(
    db,
    eventId,
    approved.occurrences.map((item) => item.id),
  );
  const routes = new Map<string, PublicationAuthoredAgendaRoute>();
  for (const source of sources) {
    const matches = authored.filter((document) => document.sourcePath === source.source_path);
    if (!matches.length) continue;
    const mode = agendaTransferModeSchema.safeParse(source.import_mode);
    if (!mode.success)
      throw new Error(
        `Authored agenda source has an invalid import mode: event=${approved.eventSlug}, occurrence=${source.id}, source=${source.source_path}, mode=${JSON.stringify(source.import_mode)}`,
      );
    if (agendaTransferModePolicy[mode.data].attribution !== "archival") continue;
    if (matches.length !== 1 || matches[0]!.sourceDigest !== source.source_digest)
      throw new Error("Authored agenda source changed since archival review");
    const owner = { ...matches[0]!, eventSlug: approved.eventSlug };
    const previous = routes.get(owner.sourcePath);
    if (previous && JSON.stringify(previous) !== JSON.stringify(owner))
      throw new Error("Authored agenda source has conflicting reviewed digests");
    routes.set(owner.sourcePath, owner);
  }
  return [...routes.values()].sort((a, b) => a.route.localeCompare(b.route));
}
