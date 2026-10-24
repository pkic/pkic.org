import type { DatabaseLike, StatementLike } from "../../types";
import type { AgendaScheduleConflictProposal } from "../../../../assets/shared/schemas/event-agenda-schedule";
import { prepareAgendaRead } from "./read";
import { commitAgendaRevision } from "./revision";

/** Return the canonical snapshot from the same atomic boundary that commits its revision. */
export async function commitAgendaSnapshot(
  db: DatabaseLike,
  eventId: string,
  eventSlug: string,
  revision: number,
  statements: StatementLike[],
  actorUserId: string | null = null,
  conflictProposal?: AgendaScheduleConflictProposal,
) {
  const response = prepareAgendaRead(db, eventId, eventSlug);
  const results = await commitAgendaRevision(
    db,
    eventId,
    revision,
    statements,
    actorUserId,
    conflictProposal,
    response.statements,
  );
  return response.decode(results);
}
