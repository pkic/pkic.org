import type { LiveModerationReason } from "../../../../assets/shared/live-moderation-policy";
import { LiveChatCheckStore } from "./room-chat-checks";
import type { LiveRoomSql } from "./room-sql";

export interface LiveChatHiding {
  held: boolean;
  by_name: string;
  at: string;
}

export interface LiveChatReports {
  count: number;
  reasons: Partial<Record<LiveModerationReason, number>>;
}

/** A message reported or flagged by the classifier and not yet reviewed: shown, or held. */
const OPEN_REPORT = `(message_id NOT IN (SELECT message_id FROM room_chat_hidden) OR message_id IN (SELECT message_id FROM room_chat_hidden WHERE held = 1))`;

function idList(ids: readonly string[]): string {
  return JSON.stringify(ids);
}

/**
 * What moderators decided about chat, kept in the session's room: hidden
 * and held messages, reports and messages made into questions. Removal
 * reasons and blocks are the shared moderation store's.
 */
export class LiveChatModerationStore {
  /** The classifier's verdicts, which a moderator's keep clears with the reports. */
  readonly checks: LiveChatCheckStore;

  constructor(private readonly sql: LiveRoomSql) {
    this.checks = new LiveChatCheckStore(sql);
  }

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
    // A hidden message leaves the top of the chat, and stays off it when it is shown again.
    this.sql.exec("DELETE FROM room_chat_pin WHERE message_id = ?", messageId);
  }

  /** The attendee message pinned above the chat. */
  pinned(): string | null {
    return this.sql.rows<{ message_id: string }>("SELECT message_id FROM room_chat_pin LIMIT 1")[0]?.message_id ?? null;
  }

  /** Pins one message, in place of any pinned before. */
  pin(messageId: string, by: string, at: string): void {
    this.sql.exec("DELETE FROM room_chat_pin");
    this.sql.exec("INSERT INTO room_chat_pin(message_id, by_name, at) VALUES (?, ?, ?)", messageId, by, at);
  }

  unpin(): void {
    this.sql.exec("DELETE FROM room_chat_pin");
  }

  /**
   * A moderator kept the message: it shows again and its reports and check verdict are settled. The keep and the
   * reports it settled stay on record, so a chat kept for tuning shows what the check and the reporters got wrong.
   */
  keep(messageId: string, at: string): void {
    this.sql.exec(
      `INSERT OR IGNORE INTO room_chat_kept_reports(message_id, user_id, reason, reported_at)
       SELECT message_id, user_id, reason, reported_at FROM room_chat_reports WHERE message_id = ?`,
      messageId,
    );
    this.sql.exec(
      "INSERT INTO room_chat_kept(message_id, at) VALUES (?, ?) ON CONFLICT(message_id) DO UPDATE SET at = excluded.at",
      messageId,
      at,
    );
    this.sql.exec("DELETE FROM room_chat_hidden WHERE message_id = ?", messageId);
    this.sql.exec("DELETE FROM room_chat_reports WHERE message_id = ?", messageId);
    this.checks.clear(messageId);
  }

  /** Records one person's report; false when they had already reported the message. */
  report(messageId: string, userId: string, reason: LiveModerationReason, at: string): boolean {
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
    for (const row of this.sql.rows<{ message_id: string; reason: LiveModerationReason; total: number }>(
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

  /** Messages awaiting review, latest report or flag first. */
  openReports(limit: number): string[] {
    return this.sql
      .rows<{ message_id: string }>(
        `SELECT message_id FROM (
           SELECT message_id, reported_at AS at FROM room_chat_reports
           UNION ALL SELECT message_id, at FROM room_chat_checks WHERE outcome IN ('advised', 'blocked')
         ) WHERE ${OPEN_REPORT}
         GROUP BY message_id ORDER BY MAX(at) DESC, message_id LIMIT ?`,
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
}
