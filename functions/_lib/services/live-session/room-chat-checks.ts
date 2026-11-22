/**
 * The automatic check's verdict on each attendee message, kept beside the
 * chat. A message waits, seen only by its author and moderators, while it is
 * checked; it stays off air when the check advised or blocked it, until a
 * moderator keeps it.
 */
import type { LiveAutomaticCheck } from "../../../../assets/shared/schemas/live-session-moderation";
import type { LiveRoomSql } from "./room-sql";

/** A check still unanswered after this long no longer holds its message back. */
export const LIVE_CHAT_CHECK_WAIT_MS = 15_000;

/** Leaves out the messages still being checked: attendees other than the author do not read them yet. */
export function liveChatCheckNotWaiting(now: number): { sql: string; bindings: string[] } {
  return {
    sql: `id NOT IN (SELECT message_id FROM room_chat_checks WHERE outcome = 'pending' AND at > ?)`,
    bindings: [new Date(now - LIVE_CHAT_CHECK_WAIT_MS).toISOString()],
  };
}

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

  /** The messages among `ids` whose check is still unanswered and recent enough to hold them back. */
  waiting(ids: readonly string[], now: number): Set<string> {
    if (!ids.length) return new Set();
    return new Set(
      this.sql
        .rows<{ message_id: string }>(
          `SELECT message_id FROM room_chat_checks
           WHERE outcome = 'pending' AND at > ? AND message_id IN (SELECT value FROM json_each(?))`,
          new Date(now - LIVE_CHAT_CHECK_WAIT_MS).toISOString(),
          JSON.stringify(ids),
        )
        .map((row) => row.message_id),
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
