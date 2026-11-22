import type { LiveModerationReason } from "../../../../assets/shared/live-moderation-policy";
import { createUserBackedAuthAdmin } from "../../auth/admin-identity";
import { preparePermissionsAuthorizationGuard } from "../../auth/permissions";
import { isAuthorizationGuardFailure } from "../../db/authorization-guard";
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
  /** The organizer, by the signed-in session their socket joined with. */
  by: { userId: string; sessionId: string };
  at: string;
}

/**
 * Runs the change only while the organizer still manages the event: the room's own copy of their access is only
 * as fresh as its last refresh. False when that access is gone, and nothing was written.
 */
async function asOrganizer(db: DatabaseLike, input: EventParticipationBlockInput, change: StatementLike[]) {
  const organizer = createUserBackedAuthAdmin({ id: input.by.userId, sessionId: input.by.sessionId, email: "" });
  try {
    await db.batch([
      preparePermissionsAuthorizationGuard(db, organizer, [
        { permission: "events:manage", context: { type: "event", id: input.eventId } },
      ]),
      ...change,
    ]);
    return true;
  } catch (error) {
    if (isAuthorizationGuardFailure(error)) return false;
    throw error;
  }
}

/** Places the event block with its audit row in one atomic batch; a second block while one is open changes nothing. */
export function blockEventParticipation(
  db: DatabaseLike,
  input: EventParticipationBlockInput & { reason: LiveModerationReason },
): Promise<boolean> {
  return asOrganizer(db, input, [
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
        input.by.userId,
        input.at,
        input.eventId,
        input.userId,
      ),
    prepareScopedAuditLogAfterOneChange(
      db,
      { type: "event", id: input.eventId },
      "user",
      input.by.userId,
      "event.participation.blocked",
      "user",
      input.userId,
      { reason: input.reason },
      input.at,
    ),
  ]);
}

/** Lifts the open event block with its audit row; lifting when none is open changes nothing. */
export function liftEventParticipationBlock(db: DatabaseLike, input: EventParticipationBlockInput): Promise<boolean> {
  return asOrganizer(db, input, [
    db
      .prepare(
        "UPDATE event_participation_blocks SET lifted_by=?,lifted_at=? WHERE event_id=? AND user_id=? AND lifted_at IS NULL",
      )
      .bind(input.by.userId, input.at, input.eventId, input.userId),
    prepareScopedAuditLogAfterOneChange(
      db,
      { type: "event", id: input.eventId },
      "user",
      input.by.userId,
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
