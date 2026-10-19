import { all, run } from "../../db/queries";
import type { DatabaseLike, Env, StatementLike } from "../../types";
import { nowIso } from "../../utils/time";
import { liveRoomName } from "./room-admission";

/**
 * Anonymizing a person reaches their live session rooms in two steps. The
 * anonymization's own D1 batch redacts the durable copy of their questions
 * and records one erasure request per room that holds them; the scheduled
 * erasure job then asks each room to forget the person and marks the request
 * done. The room's forgetting is idempotent, so the job retries until it
 * succeeds. Ballots never reach D1, and a room erases its own storage days
 * after its session, so nothing of the person outlives either.
 */

const ANONYMIZED_AUTHOR = "SELECT id FROM users WHERE active=0 AND pii_redacted_at IS NOT NULL";

/** The same canonical anonymization condition also protects room-local participant chat. */
export async function anonymizedLiveParticipantIds(db: DatabaseLike, userIds: readonly string[]): Promise<string[]> {
  if (!userIds.length) return [];
  return (
    await all<{ id: string }>(db, `${ANONYMIZED_AUTHOR} AND id IN(SELECT value FROM json_each(?))`, [
      JSON.stringify(userIds),
    ])
  ).map((row) => row.id);
}

/** An erasure upsert re-arms a finished request: new words from the person reached the room after it ran. */
const REQUEST_ERASURE = `INSERT INTO event_session_room_erasures(event_id,occurrence_id,user_id,requested_at,attempts)
  SELECT DISTINCT question.event_id,question.occurrence_id,question.author_user_id,?,0 FROM event_session_questions question`;
const REARM = `ON CONFLICT(event_id,occurrence_id,user_id) DO UPDATE SET requested_at=excluded.requested_at,
  attempts=0,last_error=NULL,completed_at=NULL`;

/** The anonymization batch's share: redact the person's copied questions and ask their rooms to forget them. */
export function prepareLiveSessionAnonymization(db: DatabaseLike, userId: string, at: string): StatementLike[] {
  return [
    db.prepare(`${REQUEST_ERASURE} WHERE question.author_user_id=? ${REARM}`).bind(at, userId),
    db
      .prepare(
        "UPDATE event_session_questions SET body='',display_text=NULL,redacted_at=? WHERE author_user_id=? AND redacted_at IS NULL",
      )
      .bind(at, userId),
  ];
}

/**
 * The durable copy's share: a question that reached D1 after its author was
 * anonymized is redacted at once and its room asked to forget them too.
 */
export function prepareLiveRoomCopyErasureGuard(
  db: DatabaseLike,
  eventId: string,
  occurrenceId: string,
  at: string,
): StatementLike[] {
  return [
    db
      .prepare(
        `${REQUEST_ERASURE} WHERE question.event_id=? AND question.occurrence_id=? AND question.redacted_at IS NULL
         AND question.author_user_id IN (${ANONYMIZED_AUTHOR}) ${REARM}`,
      )
      .bind(at, eventId, occurrenceId),
    db
      .prepare(
        `UPDATE event_session_questions SET body='',display_text=NULL,redacted_at=?
         WHERE event_id=? AND occurrence_id=? AND redacted_at IS NULL AND author_user_id IN (${ANONYMIZED_AUTHOR})`,
      )
      .bind(at, eventId, occurrenceId),
  ];
}

interface ErasureRow {
  event_id: string;
  occurrence_id: string;
  user_id: string;
  requested_at: string;
}

export type LiveSessionErasureResult = { selected: number; completed: number; failed: number };

/** Asks each room with an outstanding request to forget its person; a failure stays due for the next run. */
export async function processLiveSessionErasures(
  db: DatabaseLike,
  rooms: Env["LIVE_SESSION_ROOMS"],
  limit: number,
): Promise<LiveSessionErasureResult> {
  const result = { selected: 0, completed: 0, failed: 0 };
  if (!rooms) return result;
  const due = await all<ErasureRow>(
    db,
    `SELECT event_id,occurrence_id,user_id,requested_at FROM event_session_room_erasures
     WHERE completed_at IS NULL ORDER BY attempts,requested_at,event_id,occurrence_id,user_id LIMIT ?`,
    [limit],
  );
  result.selected = due.length;
  for (const row of due) {
    const key = [row.event_id, row.occurrence_id, row.user_id, row.requested_at];
    try {
      await rooms.getByName(liveRoomName(row.event_id, row.occurrence_id)).forgetParticipant(row.user_id);
      // A request re-armed meanwhile keeps its newer instant and stays due.
      await run(
        db,
        `UPDATE event_session_room_erasures SET completed_at=?,last_error=NULL
         WHERE event_id=? AND occurrence_id=? AND user_id=? AND requested_at=?`,
        [nowIso(), ...key],
      );
      result.completed += 1;
    } catch (error) {
      await run(
        db,
        `UPDATE event_session_room_erasures SET attempts=attempts+1,last_error=?
         WHERE event_id=? AND occurrence_id=? AND user_id=? AND requested_at=?`,
        [(error instanceof Error ? error.message : "Room unavailable").slice(0, 500), ...key],
      );
      result.failed += 1;
    }
  }
  return result;
}
