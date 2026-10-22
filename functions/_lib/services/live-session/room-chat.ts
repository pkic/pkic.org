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
];
/** Shown to attendees: not hidden by a moderator or held, and not by someone banned from the chat. */
const HIDDEN = `id NOT IN (SELECT message_id FROM room_chat_hidden)
  AND author_user_id NOT IN (SELECT user_id FROM room_chat_restrictions WHERE restriction = 'banned')`;

function select(channel: LiveChatChannel): string {
  return `SELECT id, author_user_id, author_name, body, sent_at, rowid AS seq, '${channel}' AS channel FROM ${TABLES[channel]}`;
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
   * any precede them. `shownOnly` leaves out messages hidden from attendees.
   */
  page(
    channel: LiveChatChannel,
    options: { before: LiveChatRow | null; limit: number; shownOnly: boolean },
  ): { rows: LiveChatRow[]; hasEarlier: boolean } {
    const where = [
      ...(options.before ? ["(sent_at < ? OR (sent_at = ? AND rowid < ?))"] : []),
      ...(options.shownOnly ? [HIDDEN] : []),
    ];
    const rows = this.sql.rows<LiveChatRow>(
      `${select(channel)}${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY sent_at DESC, rowid DESC LIMIT ?`,
      ...(options.before ? [options.before.sent_at, options.before.sent_at, options.before.seq] : []),
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

  /** The latest attendee messages nobody reported or hid, by people free to chat, newest first. */
  tickerRows(limit: number): LiveChatRow[] {
    return this.sql.rows<LiveChatRow>(
      `${select("attendee")} WHERE ${HIDDEN}
         AND id NOT IN (SELECT message_id FROM room_chat_reports)
         AND author_user_id NOT IN (SELECT user_id FROM room_chat_restrictions)
       ORDER BY sent_at DESC, rowid DESC LIMIT ?`,
      limit,
    );
  }

  /** One persistent per-person allowance covers both channels, so switching channels cannot reset it. */
  send(
    actor: { userId: string; name: string },
    text: string,
    now: number,
    channel: LiveChatChannel = "attendee",
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
    const dropped = this.sql
      .rows<{ id: string }>(
        `SELECT id FROM ${TABLES[channel]} ORDER BY sent_at DESC, rowid DESC LIMIT -1 OFFSET ${LIVE_CHAT_POLICY.storedMessages}`,
      )
      .map((row) => row.id);
    this.remove(dropped);
    return this.message(id);
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

  /** Everything of one person in the chat: their messages, reactions, reports, restriction and photo. */
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
    for (const table of ["room_chat_limits", "room_chat_restrictions", "room_people"])
      this.sql.exec(`DELETE FROM ${table} WHERE user_id = ?`, userId);
    return removed;
  }
}
