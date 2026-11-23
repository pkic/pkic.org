/**
 * The automatic check's verdict on each attendee message, kept beside the
 * chat. Attendees read a message at once and lose it if the check blocks it.
 * Outputs wait: a message stays off air while it is checked, and when the
 * check advised or blocked it, until a moderator keeps it.
 */
import {
  liveAutomaticCheckSchema,
  type LiveAutomaticCheck,
} from "../../../../assets/shared/schemas/live-session-moderation";
import type { LiveRoomSql } from "./room-sql";

/** A check still unanswered after this long no longer keeps its message off air; the model itself gets 4 seconds. */
export const LIVE_CHAT_CHECK_WAIT_MS = 5_000;
/** Who the room names when the automatic check holds a message. */
export const LIVE_CHAT_HELD_BY_CHECK = "Automatic check";

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
    this.sql.exec("DELETE FROM room_chat_check_flags WHERE message_id = ?", messageId);
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
    // Which questions raised it and how certain the model was, so a moderator sees why and staff can tune.
    this.sql.exec(
      `INSERT INTO room_chat_check_flags(message_id, flags_json) VALUES (?, ?)
       ON CONFLICT(message_id) DO UPDATE SET flags_json = excluded.flags_json`,
      messageId,
      JSON.stringify(check.flags ?? []),
    );
  }

  /** Nothing holds the message back for its check any longer: it passed, or a moderator kept it. */
  clear(messageId: string): void {
    this.sql.exec("DELETE FROM room_chat_checks WHERE message_id = ?", messageId);
    this.sql.exec("DELETE FROM room_chat_check_flags WHERE message_id = ?", messageId);
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
        .rows<{ message_id: string; outcome: "advised" | "blocked"; notes_json: string; flags_json: string | null }>(
          `SELECT message_id, outcome, notes_json,
             (SELECT flags_json FROM room_chat_check_flags WHERE room_chat_check_flags.message_id = room_chat_checks.message_id) AS flags_json
           FROM room_chat_checks
           WHERE outcome IN ('advised', 'blocked') AND message_id IN (SELECT value FROM json_each(?))`,
          JSON.stringify(ids),
        )
        .map((row) => [
          row.message_id,
          { outcome: row.outcome, notes: readNotes(row.notes_json), flags: readLiveCheckFlags(row.flags_json) },
        ]),
    );
  }
}

/** The stored flags when they still read as the contract's; a room from an earlier release has none. */
export function readLiveCheckFlags(json: string | null): LiveAutomaticCheck["flags"] {
  if (!json) return undefined;
  try {
    const parsed = liveAutomaticCheckSchema.shape.flags.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
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
