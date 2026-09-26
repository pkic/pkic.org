import { first } from "../db/queries";
import { AppError } from "../errors";
import type { DatabaseLike, StatementLike } from "../types";
import { uuid } from "../utils/ids";

/**
 * Registration capacity depends on the complete proposal/direct role source
 * set for an event/user. The revision is read before that source query: a
 * concurrent source edit then makes the guarded batch retry rather than
 * committing capacity derived from a stale source snapshot.
 */
export async function getEventParticipantSourceRevision(
  db: DatabaseLike,
  eventId: string,
  userId: string,
): Promise<number> {
  const row = await first<{ revision: number }>(
    db,
    `SELECT COALESCE((
       SELECT revision
       FROM event_participant_source_revisions
       WHERE event_id = ? AND user_id = ?
     ), 0) AS revision`,
    [eventId, userId],
  );
  return Number(row?.revision ?? 0);
}

export function prepareEventParticipantSourceRevisionGuard(
  db: DatabaseLike,
  input: { eventId: string; userId: string; expectedRevision: number },
): StatementLike {
  return db
    .prepare(
      `INSERT INTO event_participant_source_revision_guards (id, event_id, user_id, expected_revision)
       VALUES (?, ?, ?, ?)`,
    )
    .bind(uuid(), input.eventId, input.userId, input.expectedRevision);
}

export function isEventParticipantSourceConflict(error: unknown): boolean {
  return error instanceof Error && error.message.includes("EVENT_PARTICIPANT_SOURCE_CHANGED");
}

export function eventParticipantSourceConflictError(): AppError {
  return new AppError(
    409,
    "PROPOSAL_SPEAKER_CONFLICT",
    "Proposal speaker sources changed while this operation was processed. Please retry.",
  );
}
