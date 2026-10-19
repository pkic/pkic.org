import { LIVE_CHAT_REACTION_IDS, type LiveChatReactionId } from "../../../../assets/shared/live-chat-policy";
import type { LiveRoomSql } from "./room-sql";

export type LiveChatReactionCounts = Partial<Record<LiveChatReactionId, number>>;

/** Display order, so every viewer lists a person's reactions the same way. */
function ordered(reactions: Iterable<LiveChatReactionId>): LiveChatReactionId[] {
  const chosen = new Set(reactions);
  return LIVE_CHAT_REACTION_IDS.filter((reaction) => chosen.has(reaction));
}

/** One reaction of each kind per person per message, counted per message. */
export class LiveChatReactionStore {
  constructor(private readonly sql: LiveRoomSql) {}

  /** Adds or withdraws one reaction; false when nothing changed. */
  set(messageId: string, userId: string, reaction: LiveChatReactionId, on: boolean): boolean {
    const held = this.sql.rows<{ found: number }>(
      "SELECT COUNT(*) AS found FROM room_chat_reactions WHERE message_id = ? AND user_id = ? AND reaction = ?",
      messageId,
      userId,
      reaction,
    )[0].found;
    if (held > 0 === on) return false;
    if (on)
      this.sql.exec(
        "INSERT INTO room_chat_reactions(message_id, user_id, reaction) VALUES (?, ?, ?)",
        messageId,
        userId,
        reaction,
      );
    else
      this.sql.exec(
        "DELETE FROM room_chat_reactions WHERE message_id = ? AND user_id = ? AND reaction = ?",
        messageId,
        userId,
        reaction,
      );
    return true;
  }

  counts(ids: readonly string[]): Map<string, LiveChatReactionCounts> {
    const counts = new Map<string, LiveChatReactionCounts>();
    if (!ids.length) return counts;
    for (const row of this.sql.rows<{ message_id: string; reaction: LiveChatReactionId; total: number }>(
      `SELECT message_id, reaction, COUNT(*) AS total FROM room_chat_reactions
       WHERE message_id IN (SELECT value FROM json_each(?)) GROUP BY message_id, reaction`,
      JSON.stringify(ids),
    )) {
      const entry = counts.get(row.message_id) ?? {};
      entry[row.reaction] = row.total;
      counts.set(row.message_id, entry);
    }
    return counts;
  }

  /** Each person's own reactions on the given messages, keyed by person, then message. */
  mine(ids: readonly string[], userIds: readonly string[]): Map<string, Map<string, LiveChatReactionId[]>> {
    const mine = new Map<string, Map<string, LiveChatReactionId[]>>();
    if (!ids.length || !userIds.length) return mine;
    const rows = this.sql.rows<{ message_id: string; user_id: string; reaction: LiveChatReactionId }>(
      `SELECT message_id, user_id, reaction FROM room_chat_reactions
       WHERE message_id IN (SELECT value FROM json_each(?)) AND user_id IN (SELECT value FROM json_each(?))`,
      JSON.stringify(ids),
      JSON.stringify(userIds),
    );
    for (const row of rows) {
      const person = mine.get(row.user_id) ?? new Map<string, LiveChatReactionId[]>();
      person.set(row.message_id, [...(person.get(row.message_id) ?? []), row.reaction]);
      mine.set(row.user_id, person);
    }
    for (const person of mine.values())
      for (const [messageId, reactions] of person) person.set(messageId, ordered(reactions));
    return mine;
  }
}
