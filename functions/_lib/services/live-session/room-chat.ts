import type { DatabaseLike } from "../../types";
import { anonymizedLiveParticipantIds } from "./room-erasure";
import { LIVE_ROOM_POLICY } from "../../../../assets/shared/live-session-policy";
import { LIVE_CHAT_POLICY } from "../../../../assets/shared/live-chat-policy";
import type { LiveChatChannel } from "../../../../assets/shared/schemas/live-session-chat";
import type { LiveRoomSql } from "./room-sql";

export interface LiveChatRemoval {
  id: string;
  channel: LiveChatChannel;
}
export interface LiveChatRow extends LiveChatRemoval {
  author_user_id: string;
  author_name: string;
  body: string;
  sent_at: string;
  /** Insertion order, the tie-break after the send time. */
  seq: number;
  /** In a location's chat, the session on there when it was sent; null in a break and in a session's room. */
  occurrence_id: string | null;
  /** The message this one answers. */
  reply_to: string | null;
  /** When its author last edited it. */
  edited_at: string | null;
}
/** One attendee message as an organizer's archive keeps it. */
export interface LiveChatArchiveRow {
  sent_at: string;
  author_name: string;
  body: string;
  /** The session the message was sent during; null between sessions. */
  occurrence_id: string | null;
  /** When its author last edited it; the body is the edited one. */
  edited_at: string | null;
  /** Shown to attendees, removed by a moderator, or held after reports. */
  status: "shown" | "hidden" | "held";
}
const TABLES: Record<LiveChatChannel, string> = { attendee: "room_chat", operator: "room_operator_chat" };
const CHANNELS = Object.keys(TABLES) as LiveChatChannel[];
/** The tables that annotate a message; a message leaves with its annotations. */
const ANNOTATIONS = [
  "room_chat_reactions",
  "room_chat_reports",
  "room_chat_hidden",
  "room_chat_questions",
  "room_chat_authorship",
  "room_chat_sessions",
  "room_chat_pin",
  "room_chat_replies",
  "room_chat_edits",
  "room_chat_aired",
];
/** Shown to attendees: not removed by a moderator or held after reports. */
const HIDDEN = `id NOT IN (SELECT message_id FROM room_chat_hidden)`;

function select(channel: LiveChatChannel): string {
  return `SELECT id, author_user_id, author_name, body, sent_at, rowid AS seq, '${channel}' AS channel,
    (SELECT occurrence_id FROM room_chat_sessions WHERE message_id = id) AS occurrence_id,
    (SELECT parent_id FROM room_chat_replies WHERE message_id = id) AS reply_to,
    (SELECT edited_at FROM room_chat_edits WHERE message_id = id) AS edited_at FROM ${TABLES[channel]}`;
}

/**
 * Both channels' messages, kept in this session's room. Enum-selected tables
 * never take an SQL identifier from input. A channel keeps its latest
 * messages up to the stored limit; a viewer receives one page at a time.
 */
export class LiveRoomChat {
  constructor(private readonly sql: LiveRoomSql) {}

  /**
   * A channel's latest messages before `before`, oldest first, and whether
   * any precede them. `shownOnly` leaves out messages hidden from attendees,
   * except those `author` wrote: an author keeps seeing their removed messages.
   */
  page(
    channel: LiveChatChannel,
    options: { before: LiveChatRow | null; limit: number; shownOnly: boolean; author?: string | null },
  ): { rows: LiveChatRow[]; hasEarlier: boolean } {
    const where = [
      ...(options.before ? ["(sent_at < ? OR (sent_at = ? AND rowid < ?))"] : []),
      ...(options.shownOnly ? [`(${HIDDEN} OR author_user_id = ?)`] : []),
    ];
    const rows = this.sql.rows<LiveChatRow>(
      `${select(channel)}${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY sent_at DESC, rowid DESC LIMIT ?`,
      ...(options.before ? [options.before.sent_at, options.before.sent_at, options.before.seq] : []),
      ...(options.shownOnly ? [options.author ?? ""] : []),
      options.limit + 1,
    );
    return { rows: rows.slice(0, options.limit).reverse(), hasEarlier: rows.length > options.limit };
  }

  message(id: string): LiveChatRow | null {
    for (const channel of CHANNELS) {
      const [row] = this.sql.rows<LiveChatRow>(`${select(channel)} WHERE id = ?`, id);
      if (row) return row;
    }
    return null;
  }

  /** Messages by id, in the order asked; ids no longer held are skipped. */
  messages(ids: readonly string[]): LiveChatRow[] {
    if (!ids.length) return [];
    const json = JSON.stringify(ids);
    const found = new Map(
      CHANNELS.flatMap((channel) =>
        this.sql.rows<LiveChatRow>(`${select(channel)} WHERE id IN (SELECT value FROM json_each(?))`, json),
      ).map((row) => [row.id, row]),
    );
    return ids.flatMap((id) => found.get(id) ?? []);
  }

  /** One person's latest attendee messages, oldest first. */
  byAuthor(userId: string, limit: number): LiveChatRow[] {
    return this.sql
      .rows<LiveChatRow>(
        `${select("attendee")} WHERE author_user_id = ? ORDER BY sent_at DESC, rowid DESC LIMIT ?`,
        userId,
        limit,
      )
      .reverse();
  }

  /**
   * The latest attendee messages nobody reported or removed, by people not
   * blocked, newest first; only those sent by `sentBy` when a wait applies.
   */
  tickerRows(limit: number, sentBy: string | null = null): LiveChatRow[] {
    return this.sql.rows<LiveChatRow>(
      `${select("attendee")} WHERE ${HIDDEN}
         AND id NOT IN (SELECT message_id FROM room_chat_reports)
         AND author_user_id NOT IN (SELECT user_id FROM room_participation_blocks
           WHERE until IS NULL OR until > strftime('%Y-%m-%dT%H:%M:%fZ', 'now') UNION SELECT user_id FROM room_event_blocks)
         ${sentBy ? "AND sent_at <= ?" : ""}
       ORDER BY sent_at DESC, rowid DESC LIMIT ?`,
      ...(sentBy ? [sentBy] : []),
      limit,
    );
  }

  /** When the oldest attendee message sent after `since` was sent, or null when there is none. */
  firstSentAfter(since: string): string | null {
    const [row] = this.sql.rows<{ sent_at: string }>(
      "SELECT sent_at FROM room_chat WHERE sent_at > ? ORDER BY sent_at, rowid LIMIT 1",
      since,
    );
    return row?.sent_at ?? null;
  }

  /**
   * One persistent per-person allowance covers both channels, so switching channels cannot reset it. A
   * location's chat dates the message by `occurrenceId`, the session on when it was sent, and counts it there.
   * A reply names the message it answers; whether it may is the caller's to check.
   */
  send(
    actor: { userId: string; name: string },
    text: string,
    now: number,
    channel: LiveChatChannel = "attendee",
    occurrenceId: string | null = null,
    replyTo: string | null = null,
  ): LiveChatRow | null {
    const cutoff = now - LIVE_ROOM_POLICY.chatPerPerson.windowSeconds * 1000;
    this.sql.exec("DELETE FROM room_chat_limits WHERE last_sent_at<=?", cutoff);
    const prior = this.sql.rows<{ sent_times_json: string }>(
      "SELECT sent_times_json FROM room_chat_limits WHERE user_id=?",
      actor.userId,
    )[0];
    const times: number[] = prior ? JSON.parse(prior.sent_times_json) : [];
    const recent = times.filter((time) => time > cutoff);
    if (recent.length >= LIVE_ROOM_POLICY.chatPerPerson.limit) return null;
    this.sql.exec(
      "INSERT INTO room_chat_limits(user_id,sent_times_json,last_sent_at) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET sent_times_json=excluded.sent_times_json,last_sent_at=excluded.last_sent_at",
      actor.userId,
      JSON.stringify([...recent, now]),
      now,
    );
    const id = crypto.randomUUID();
    const sentAt = new Date(now).toISOString();
    this.sql.exec(
      `INSERT INTO ${TABLES[channel]}(id,author_user_id,author_name,body,sent_at) VALUES(?,?,?,?,?)`,
      id,
      actor.userId,
      actor.name,
      text,
      sentAt,
    );
    if (occurrenceId)
      this.sql.exec("INSERT INTO room_chat_sessions(message_id,occurrence_id) VALUES(?,?)", id, occurrenceId);
    if (replyTo) this.sql.exec("INSERT INTO room_chat_replies(message_id,parent_id) VALUES(?,?)", id, replyTo);
    if (channel === "attendee") {
      if (occurrenceId) {
        this.sql.exec(
          "INSERT INTO room_chat_session_totals(occurrence_id,messages,change_seq) VALUES(?,1,?) ON CONFLICT(occurrence_id) DO UPDATE SET messages=messages+1,change_seq=excluded.change_seq",
          occurrenceId,
          this.sql.nextChange(),
        );
        this.sql.exec(
          "INSERT OR IGNORE INTO room_chat_session_senders(occurrence_id,user_id) VALUES(?,?)",
          occurrenceId,
          actor.userId,
        );
      }
    }
    const dropped = this.sql
      .rows<{ id: string }>(
        // The pinned message stays on top of the chat however long the day runs.
        `SELECT id FROM ${TABLES[channel]} WHERE id NOT IN (SELECT message_id FROM room_chat_pin)
         ORDER BY sent_at DESC, rowid DESC LIMIT -1 OFFSET ${LIVE_CHAT_POLICY.storedMessages}`,
      )
      .map((row) => row.id);
    this.remove(dropped);
    return this.message(id);
  }

  /** New words for a message; the room keeps what was first sent, for moderators. */
  edit(row: LiveChatRow, text: string, at: string): LiveChatRow | null {
    this.sql.exec(
      "INSERT INTO room_chat_edits(message_id,original_body,edited_at) VALUES(?,?,?) ON CONFLICT(message_id) DO UPDATE SET edited_at=excluded.edited_at",
      row.id,
      row.body,
      at,
    );
    this.sql.exec(`UPDATE ${TABLES[row.channel]} SET body=? WHERE id=?`, text, row.id);
    return this.message(row.id);
  }

  /** What the authors first sent, for the messages they edited since. */
  originals(ids: readonly string[]): Map<string, string> {
    if (!ids.length) return new Map();
    return new Map(
      this.sql
        .rows<{ message_id: string; original_body: string }>(
          "SELECT message_id, original_body FROM room_chat_edits WHERE message_id IN (SELECT value FROM json_each(?))",
          JSON.stringify(ids),
        )
        .map((row) => [row.message_id, row.original_body]),
    );
  }

  /** Messages a broadcast read to show: their words stay as they went on screen. */
  aired(ids: readonly string[]): Set<string> {
    if (!ids.length) return new Set();
    return new Set(
      this.sql
        .rows<{ message_id: string }>(
          "SELECT message_id FROM room_chat_aired WHERE message_id IN (SELECT value FROM json_each(?))",
          JSON.stringify(ids),
        )
        .map((row) => row.message_id),
    );
  }

  markAired(ids: readonly string[]): void {
    if (!ids.length) return;
    this.sql.exec(
      "INSERT OR IGNORE INTO room_chat_aired(message_id) SELECT value FROM json_each(?)",
      JSON.stringify(ids),
    );
  }

  /** Removes messages with their reactions, reports and moderation. */
  remove(ids: readonly string[]): void {
    if (!ids.length) return;
    const json = JSON.stringify(ids);
    for (const table of [...Object.values(TABLES)])
      this.sql.exec(`DELETE FROM ${table} WHERE id IN (SELECT value FROM json_each(?))`, json);
    for (const table of ANNOTATIONS)
      this.sql.exec(`DELETE FROM ${table} WHERE message_id IN (SELECT value FROM json_each(?))`, json);
  }

  holdsMessages(): boolean {
    return this.sql.rows("SELECT 1 FROM room_chat LIMIT 1").length > 0;
  }

  /** Every attendee message the room still holds, oldest first, with how moderation left it. */
  archive(): LiveChatArchiveRow[] {
    return this.sql.rows<LiveChatArchiveRow>(
      `SELECT c.sent_at, c.author_name, c.body, s.occurrence_id, e.edited_at,
         CASE WHEN h.held = 1 THEN 'held' WHEN h.message_id IS NOT NULL THEN 'hidden' ELSE 'shown' END AS status
       FROM room_chat c LEFT JOIN room_chat_hidden h ON h.message_id = c.id
       LEFT JOIN room_chat_sessions s ON s.message_id = c.id
       LEFT JOIN room_chat_edits e ON e.message_id = c.id
       ORDER BY c.sent_at, c.rowid`,
    );
  }

  /** Removes every message of both channels with their annotations; the chat counts stay. */
  eraseAll(): LiveChatRemoval[] {
    const removed = CHANNELS.flatMap((channel) =>
      this.sql.rows<LiveChatRemoval>(`SELECT id, '${channel}' AS channel FROM ${TABLES[channel]}`),
    );
    this.remove(removed.map((row) => row.id));
    return removed;
  }

  authors(): string[] {
    return CHANNELS.flatMap((channel) =>
      this.sql.rows<{ id: string }>(`SELECT DISTINCT author_user_id AS id FROM ${TABLES[channel]}`),
    ).map((row) => row.id);
  }

  async eraseAnonymizedAuthors(db: DatabaseLike): Promise<LiveChatRemoval[]> {
    const authors = [...new Set(this.authors())];
    const removed: LiveChatRemoval[] = [];
    for (const userId of await anonymizedLiveParticipantIds(db, authors)) removed.push(...this.forget(userId));
    return removed;
  }

  /** Everything of one person in the chat: their messages, reactions, reports and photo. */
  forget(userId: string): LiveChatRemoval[] {
    const removed = CHANNELS.flatMap((channel) =>
      this.sql.rows<LiveChatRemoval>(
        `SELECT id, '${channel}' AS channel FROM ${TABLES[channel]} WHERE author_user_id = ?`,
        userId,
      ),
    );
    this.remove(removed.map((row) => row.id));
    for (const table of ["room_chat_reactions", "room_chat_reports"])
      this.sql.exec(`DELETE FROM ${table} WHERE user_id = ?`, userId);
    for (const table of ["room_chat_limits", "room_people"])
      this.sql.exec(`DELETE FROM ${table} WHERE user_id = ?`, userId);
    for (const { occurrence_id } of this.sql.rows<{ occurrence_id: string }>(
      "DELETE FROM room_chat_session_senders WHERE user_id = ? RETURNING occurrence_id",
      userId,
    ))
      this.sql.exec(
        "UPDATE room_chat_session_totals SET change_seq=? WHERE occurrence_id=?",
        this.sql.nextChange(),
        occurrence_id,
      );
    return removed;
  }
}
