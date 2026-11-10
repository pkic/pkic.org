import { screenRecordSchema, type ScreenRecord } from "../../../../assets/shared/schemas/event-screens";
import { batchFirst } from "../../db/pagination";
import type { D1StatementResult, DatabaseLike, StatementLike } from "../../types";

/**
 * The staff read model of a screen: its record, its room's name, and its
 * newest unrevoked, unexpired sign-in (an active one before a pending one).
 * The session is picked by one indexed subquery per screen, so a page of
 * screens stays one statement.
 */
export const SCREEN_RECORD_SELECT = `SELECT screen.id,screen.name,screen.event_id,screen.room_id,room.name AS room_name,
  screen.output,screen.layout,screen.assigned_by,screen.assigned_at,screen.revision,screen.created_at,
  session.activated_at AS session_activated_at,session.last_seen_at AS session_last_seen_at,
  session.expires_at AS session_expires_at,session.id AS session_id`;

export const SCREEN_RECORD_FROM = `FROM screens screen
  LEFT JOIN event_agenda_rooms room ON room.id=screen.room_id AND room.event_id=screen.event_id
  LEFT JOIN screen_sessions session ON session.id=(
    SELECT candidate.id FROM screen_sessions candidate
     WHERE candidate.screen_id=screen.id AND candidate.revoked_at IS NULL
       AND candidate.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
     ORDER BY candidate.activated_at IS NULL, candidate.created_at DESC, candidate.id DESC LIMIT 1)`;

export interface ScreenRecordRow {
  id: string;
  name: string;
  event_id: string | null;
  room_id: string | null;
  room_name: string | null;
  output: string | null;
  layout: string | null;
  assigned_by: string | null;
  assigned_at: string | null;
  revision: number;
  created_at: string;
  session_id: string | null;
  session_activated_at: string | null;
  session_last_seen_at: string | null;
  session_expires_at: string | null;
}

export function prepareScreenRecordRead(db: DatabaseLike, screenId: string): StatementLike {
  return db.prepare(`${SCREEN_RECORD_SELECT} ${SCREEN_RECORD_FROM} WHERE screen.id=?`).bind(screenId);
}

export function decodeScreenRecordRow(result: D1StatementResult): ScreenRecordRow | null {
  return batchFirst<ScreenRecordRow>(result);
}

/** A screen is assigned only while its room still exists in its event and it names an output. */
export function toScreenRecord(row: ScreenRecordRow): ScreenRecord {
  const assigned = row.room_id && row.room_name !== null && row.output && row.assigned_at;
  return screenRecordSchema.parse({
    id: row.id,
    name: row.name,
    eventId: row.event_id,
    assignment: assigned
      ? {
          roomId: row.room_id,
          roomName: row.room_name,
          output: row.output,
          layout: row.layout,
          assignedAt: row.assigned_at,
        }
      : null,
    revision: row.revision,
    session: {
      state: row.session_id === null ? "none" : row.session_activated_at === null ? "pending" : "active",
      activatedAt: row.session_activated_at,
      lastSeenAt: row.session_last_seen_at,
      expiresAt: row.session_expires_at,
    },
    createdAt: row.created_at,
  });
}
