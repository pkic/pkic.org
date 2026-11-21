import type { LiveModerationReason } from "../../../../assets/shared/live-moderation-policy";
import type { DatabaseLike, StatementLike } from "../../types";
import { prepareScopedAuditLogAfterOneChange } from "../audit";

/**
 * Event-wide participation blocks: an organizer keeps a person from posting,
 * voting and reacting in every session of one event until an organizer lifts
 * it. One open block per person and event; a lifted block stays as history.
 */
export interface EventParticipationBlockInput {
  eventId: string;
  userId: string;
  by: string;
  at: string;
}

/** Places the event block with its audit row in one atomic batch; a second block while one is open changes nothing. */
export async function blockEventParticipation(
  db: DatabaseLike,
  input: EventParticipationBlockInput & { reason: LiveModerationReason },
): Promise<void> {
  await db.batch([
    db
      .prepare(
        `INSERT INTO event_participation_blocks(id,event_id,user_id,reason,blocked_by,blocked_at)
         SELECT ?,?,?,?,?,? WHERE NOT EXISTS (
           SELECT 1 FROM event_participation_blocks WHERE event_id=? AND user_id=? AND lifted_at IS NULL)`,
      )
      .bind(
        crypto.randomUUID(),
        input.eventId,
        input.userId,
        input.reason,
        input.by,
        input.at,
        input.eventId,
        input.userId,
      ),
    prepareScopedAuditLogAfterOneChange(
      db,
      { type: "event", id: input.eventId },
      "user",
      input.by,
      "event.participation.blocked",
      "user",
      input.userId,
      { reason: input.reason },
      input.at,
    ),
  ]);
}

/** Lifts the open event block with its audit row; lifting when none is open changes nothing. */
export async function liftEventParticipationBlock(
  db: DatabaseLike,
  input: EventParticipationBlockInput,
): Promise<void> {
  await db.batch([
    db
      .prepare(
        "UPDATE event_participation_blocks SET lifted_by=?,lifted_at=? WHERE event_id=? AND user_id=? AND lifted_at IS NULL",
      )
      .bind(input.by, input.at, input.eventId, input.userId),
    prepareScopedAuditLogAfterOneChange(
      db,
      { type: "event", id: input.eventId },
      "user",
      input.by,
      "event.participation.lifted",
      "user",
      input.userId,
      {},
      input.at,
    ),
  ]);
}

/** Which of these people have an open event block; read with the room's access refresh. */
export function prepareEventParticipationBlocked(
  db: DatabaseLike,
  eventId: string,
  userIds: readonly string[],
): StatementLike {
  return db
    .prepare(
      `SELECT user_id FROM event_participation_blocks
       WHERE event_id=? AND lifted_at IS NULL AND user_id IN (SELECT value FROM json_each(?))`,
    )
    .bind(eventId, JSON.stringify([...new Set(userIds)]));
}
