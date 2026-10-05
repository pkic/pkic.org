import type { AgendaSnapshot } from "../../../../assets/shared/schemas/event-agenda";
import { agendaContentFieldsSchema } from "../../../../assets/shared/schemas/event-agenda-content";
import type { SessionProposalRepresentation } from "../../../../assets/shared/schemas/event-session-history";
import type { DatabaseLike, StatementLike } from "../../types";
import { nowIso } from "../../utils/time";

/** Reimports expose changed suggestions while leaving approved event credits frozen. */
export function prepareImportedProposalRepresentations(
  db: DatabaseLike,
  eventId: string,
  snapshot: AgendaSnapshot,
  sources: Array<{ id: string; source_key: string }>,
  candidates: Array<{ sourceKey: string }>,
  representations: Map<string, SessionProposalRepresentation[]>,
  contentIds: Map<string, string>,
) {
  const statements: StatementLike[] = [],
    reviewSourceKeys: string[] = [];
  let reviewRequired = 0;
  for (const candidate of candidates) {
    const incoming = representations.get(candidate.sourceKey);
    if (!incoming) continue;
    const occurrences = snapshot.occurrences.filter((item) =>
      sources.some((source) => source.id === item.id && source.source_key === candidate.sourceKey),
    );
    if (!occurrences.length) continue;
    const canonical = (items: SessionProposalRepresentation[]) =>
      JSON.stringify([...items].sort((a, b) => a.userId.localeCompare(b.userId)));
    if (occurrences.every((item) => canonical(item.history?.proposalRepresentations ?? []) === canonical(incoming)))
      continue;
    reviewRequired++;
    reviewSourceKeys.push(candidate.sourceKey);
    statements.push(
      db.prepare("UPDATE event_agenda_contents SET source_review_json=?,updated_at=? WHERE id=? AND event_id=?").bind(
        JSON.stringify({
          reason: "source_changed",
          incoming: agendaContentFieldsSchema.parse(candidate),
          incomingProposalRepresentations: incoming,
        }),
        nowIso(),
        contentIds.get(candidate.sourceKey),
        eventId,
      ),
    );
  }
  return { statements, reviewRequired, reviewSourceKeys };
}
