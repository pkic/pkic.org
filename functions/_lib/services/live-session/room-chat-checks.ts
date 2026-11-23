/**
 * The automatic check's verdict on each attendee message, kept beside the
 * chat. Attendees read a message at once and lose it if the check blocks it.
 * Outputs wait: a message stays off air while it is checked, and when the
 * check advised or blocked it, until a moderator keeps it.
 */
import type { LiveAutomaticCheck } from "../../../../assets/shared/schemas/live-session-moderation";
import type { LiveRoomSql } from "./room-sql";

/** A check still unanswered after this long no longer keeps its message off air; the model itself gets 4 seconds. */
export const LIVE_CHAT_CHECK_WAIT_MS = 5_000;

/** Messages the on-air outputs leave out for their check: flagged, or still being checked. */
export function liveChatCheckHoldsBack(now: number): { sql: string; bindings: string[] } {
  return {
    sql: `id NOT IN (SELECT message_id FROM room_chat_checks
      WHERE outcome IN ('advised', 'blocked') OR (outcome = 'pending' AND at > ?))`,
    bindings: [new Date(now - LIVE_CHAT_CHECK_WAIT_MS).toISOString()],
  };
}

export class LiveChatCheckStore {
  constructor(private readonly sql: LiveRoomSql) {}

  /** The message is being checked; it waits off air until the verdict. */
  pending(messageId: string, at: string): void {
    this.sql.exec(
      `INSERT INTO room_chat_checks(message_id, outcome, notes_json, at) VALUES (?, 'pending', '[]', ?)
       ON CONFLICT(message_id) DO UPDATE SET outcome = 'pending', notes_json = '[]', at = excluded.at`,
      messageId,
      at,
    );
  }

  record(messageId: string, check: LiveAutomaticCheck, at: string): void {
    this.sql.exec(
      `INSERT INTO room_chat_checks(message_id, outcome, notes_json, at) VALUES (?, ?, ?, ?)
       ON CONFLICT(message_id) DO UPDATE SET outcome = excluded.outcome, notes_json = excluded.notes_json, at = excluded.at`,
      messageId,
      check.outcome,
      JSON.stringify(check.notes),
      at,
    );
  }

  /** Nothing holds the message back for its check any longer: it passed, or a moderator kept it. */
  clear(messageId: string): void {
    this.sql.exec("DELETE FROM room_chat_checks WHERE message_id = ?", messageId);
  }

  /** How many of one author's attendee messages the check blocked since `since`; kept ones no longer count. */
  blockedSince(authorUserId: string, since: string): number {
    return (
      this.sql.rows<{ blocked: number }>(
        `SELECT COUNT(*) AS blocked FROM room_chat_checks
         JOIN room_chat ON room_chat.id = room_chat_checks.message_id
         WHERE room_chat_checks.outcome = 'blocked' AND room_chat_checks.at >= ? AND room_chat.author_user_id = ?`,
        since,
        authorUserId,
      )[0]?.blocked ?? 0
    );
  }

  /** The flagged messages among `ids`, as moderators see them. */
  flagged(ids: readonly string[]): Map<string, LiveAutomaticCheck> {
    if (!ids.length) return new Map();
    return new Map(
      this.sql
        .rows<{ message_id: string; outcome: "advised" | "blocked"; notes_json: string }>(
          `SELECT message_id, outcome, notes_json FROM room_chat_checks
           WHERE outcome IN ('advised', 'blocked') AND message_id IN (SELECT value FROM json_each(?))`,
          JSON.stringify(ids),
        )
        .map((row) => [row.message_id, { outcome: row.outcome, notes: readNotes(row.notes_json) }]),
    );
  }
}

function readNotes(json: string): string[] {
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((note): note is string => typeof note === "string") : [];
  } catch {
    return [];
  }
}
