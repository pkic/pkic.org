import type { LiveChatReportReason, LiveChatRestriction } from "../../../../assets/shared/live-chat-policy";
import type { LiveRoomSql } from "./room-sql";

export interface LiveChatHiding {
  held: boolean;
  by_name: string;
  at: string;
}

export interface LiveChatReports {
  count: number;
  reasons: Partial<Record<LiveChatReportReason, number>>;
}

/** A message reported and not yet reviewed: shown, or held after enough reports. */
const OPEN_REPORT = `message_id IN (SELECT message_id FROM room_chat_reports)
  AND (message_id NOT IN (SELECT message_id FROM room_chat_hidden) OR message_id IN (SELECT message_id FROM room_chat_hidden WHERE held = 1))`;

function idList(ids: readonly string[]): string {
  return JSON.stringify(ids);
}

/**
 * What moderators decided about chat, kept in the session's room: hidden
 * and held messages, reports, messages made into questions, and the people
 * an organizer muted or banned for the session.
 */
export class LiveChatModerationStore {
  constructor(private readonly sql: LiveRoomSql) {}

  hidden(ids: readonly string[]): Map<string, LiveChatHiding> {
    if (!ids.length) return new Map();
    return new Map(
      this.sql
        .rows<{ message_id: string; held: number; by_name: string; at: string }>(
          "SELECT message_id, held, by_name, at FROM room_chat_hidden WHERE message_id IN (SELECT value FROM json_each(?))",
          idList(ids),
        )
        .map((row) => [row.message_id, { held: row.held === 1, by_name: row.by_name, at: row.at }]),
    );
  }

  hide(messageId: string, by: string, held: boolean, at: string): void {
    this.sql.exec(
      `INSERT INTO room_chat_hidden(message_id, held, by_name, at) VALUES (?, ?, ?, ?)
       ON CONFLICT(message_id) DO UPDATE SET held = excluded.held, by_name = excluded.by_name, at = excluded.at`,
      messageId,
      held ? 1 : 0,
      by,
      at,
    );
  }

  /** Keeps a message: shown again, its reports reviewed and cleared. */
  keep(messageId: string): void {
    this.sql.exec("DELETE FROM room_chat_hidden WHERE message_id = ?", messageId);
    this.sql.exec("DELETE FROM room_chat_reports WHERE message_id = ?", messageId);
  }

  /** Records one person's report; false when they had already reported the message. */
  report(messageId: string, userId: string, reason: LiveChatReportReason, at: string): boolean {
    const before = this.reportCount(messageId);
    this.sql.exec(
      "INSERT OR IGNORE INTO room_chat_reports(message_id, user_id, reason, reported_at) VALUES (?, ?, ?, ?)",
      messageId,
      userId,
      reason,
      at,
    );
    return this.reportCount(messageId) > before;
  }

  reportCount(messageId: string): number {
    return this.sql.rows<{ total: number }>(
      "SELECT COUNT(*) AS total FROM room_chat_reports WHERE message_id = ?",
      messageId,
    )[0].total;
  }

  reports(ids: readonly string[]): Map<string, LiveChatReports> {
    const reports = new Map<string, LiveChatReports>();
    if (!ids.length) return reports;
    for (const row of this.sql.rows<{ message_id: string; reason: LiveChatReportReason; total: number }>(
      `SELECT message_id, reason, COUNT(*) AS total FROM room_chat_reports
       WHERE message_id IN (SELECT value FROM json_each(?)) GROUP BY message_id, reason`,
      idList(ids),
    )) {
      const entry = reports.get(row.message_id) ?? { count: 0, reasons: {} };
      entry.count += row.total;
      entry.reasons[row.reason] = row.total;
      reports.set(row.message_id, entry);
    }
    return reports;
  }

  /** The messages among `ids` that each person reported. */
  reportedBy(ids: readonly string[], userIds: readonly string[]): Map<string, Set<string>> {
    const reported = new Map<string, Set<string>>();
    if (!ids.length || !userIds.length) return reported;
    for (const row of this.sql.rows<{ message_id: string; user_id: string }>(
      `SELECT message_id, user_id FROM room_chat_reports
       WHERE message_id IN (SELECT value FROM json_each(?)) AND user_id IN (SELECT value FROM json_each(?))`,
      idList(ids),
      idList(userIds),
    ))
      reported.set(row.user_id, (reported.get(row.user_id) ?? new Set()).add(row.message_id));
    return reported;
  }

  /** Everyone who reported one message. */
  reporters(messageId: string): string[] {
    return this.sql
      .rows<{ user_id: string }>("SELECT user_id FROM room_chat_reports WHERE message_id = ?", messageId)
      .map((row) => row.user_id);
  }

  /** Messages awaiting review, latest report first. */
  openReports(limit: number): string[] {
    return this.sql
      .rows<{ message_id: string }>(
        `SELECT message_id FROM room_chat_reports WHERE ${OPEN_REPORT}
         GROUP BY message_id ORDER BY MAX(reported_at) DESC, message_id LIMIT ?`,
        limit,
      )
      .map((row) => row.message_id);
  }

  linkQuestion(messageId: string, questionId: string): void {
    this.sql.exec(
      "INSERT OR IGNORE INTO room_chat_questions(message_id, question_id) VALUES (?, ?)",
      messageId,
      questionId,
    );
  }

  questions(ids: readonly string[]): Map<string, string> {
    if (!ids.length) return new Map();
    return new Map(
      this.sql
        .rows<{ message_id: string; question_id: string }>(
          "SELECT message_id, question_id FROM room_chat_questions WHERE message_id IN (SELECT value FROM json_each(?))",
          idList(ids),
        )
        .map((row) => [row.message_id, row.question_id]),
    );
  }

  restriction(userId: string | null): LiveChatRestriction | null {
    if (!userId) return null;
    return (
      this.sql.rows<{ restriction: LiveChatRestriction }>(
        "SELECT restriction FROM room_chat_restrictions WHERE user_id = ?",
        userId,
      )[0]?.restriction ?? null
    );
  }

  restrictions(userIds: readonly string[]): Map<string, LiveChatRestriction> {
    if (!userIds.length) return new Map();
    return new Map(
      this.sql
        .rows<{ user_id: string; restriction: LiveChatRestriction }>(
          "SELECT user_id, restriction FROM room_chat_restrictions WHERE user_id IN (SELECT value FROM json_each(?))",
          idList(userIds),
        )
        .map((row) => [row.user_id, row.restriction]),
    );
  }

  restrict(userId: string, restriction: LiveChatRestriction | null, by: string, at: string): void {
    if (restriction === null) {
      this.sql.exec("DELETE FROM room_chat_restrictions WHERE user_id = ?", userId);
      return;
    }
    this.sql.exec(
      `INSERT INTO room_chat_restrictions(user_id, restriction, by_name, at) VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET restriction = excluded.restriction, by_name = excluded.by_name, at = excluded.at`,
      userId,
      restriction,
      by,
      at,
    );
  }

  /** Everyone banned from the chat; they receive none of it. */
  banned(): Set<string> {
    return new Set(
      this.sql
        .rows<{ user_id: string }>("SELECT user_id FROM room_chat_restrictions WHERE restriction = 'banned'")
        .map((row) => row.user_id),
    );
  }
}
