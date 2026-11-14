import {
  defaultLivePreparedQuestionWindow,
  type LivePreparedQuestionWindow,
} from "../../../../assets/shared/live-session-policy";
import {
  livePreparedQuestionWindowSchema,
  type LivePreparedQuestion,
} from "../../../../assets/shared/schemas/live-session-prepared-question";
import type { LiveRoomSession } from "../../../../assets/shared/schemas/live-session-room";
import type { LiveRoomSql } from "./room-sql";
import type { LiveQuestionAddressee } from "./room-store";

export interface LivePreparedQuestionRow {
  id: string;
  body: string;
  addressed_to_credit_key: string | null;
  addressed_to_user_id: string | null;
  release_at: string;
  created_by_user_id: string;
  created_by_name: string;
  created_at: string;
  revision: number;
}

type Operator = { userId: string; name: string };

const COLUMNS = `id, body, addressed_to_credit_key, addressed_to_user_id, release_at, created_by_user_id,
  created_by_name, created_at, revision`;
const WINDOW_CONTROL = "preparedQuestionWindow";

/** A waiting question as operators see it. */
export function projectLivePreparedQuestion(row: LivePreparedQuestionRow): LivePreparedQuestion {
  return {
    id: row.id,
    text: row.body,
    addressedTo: row.addressed_to_credit_key,
    releaseAt: row.release_at,
    revision: row.revision,
  };
}

/**
 * The questions operators prepared that have not come into the open list
 * yet, and the window they come in. A released question leaves this table:
 * from then on it is an ordinary question in the room's `questions`.
 */
export class LivePreparedQuestionStore {
  constructor(private readonly sql: LiveRoomSql) {}

  /** Every waiting question, soonest release first. */
  list(): LivePreparedQuestionRow[] {
    return this.sql.rows<LivePreparedQuestionRow>(`SELECT ${COLUMNS} FROM prepared_questions ORDER BY release_at, id`);
  }

  get(id: string): LivePreparedQuestionRow | null {
    return (
      this.sql.rows<LivePreparedQuestionRow>(`SELECT ${COLUMNS} FROM prepared_questions WHERE id = ?`, id)[0] ?? null
    );
  }

  count(): number {
    return this.sql.rows<{ total: number }>("SELECT COUNT(*) AS total FROM prepared_questions")[0].total;
  }

  /** The waiting questions whose release moment has come, soonest first. */
  due(at: string): LivePreparedQuestionRow[] {
    return this.sql.rows<LivePreparedQuestionRow>(
      `SELECT ${COLUMNS} FROM prepared_questions WHERE release_at <= ? ORDER BY release_at, id`,
      at,
    );
  }

  /** The next release moment after `at`, as epoch milliseconds, or null when none is waiting. */
  nextReleaseAfter(at: string): number | null {
    const [row] = this.sql.rows<{ release_at: string | null }>(
      "SELECT MIN(release_at) AS release_at FROM prepared_questions WHERE release_at > ?",
      at,
    );
    return row?.release_at ? Date.parse(row.release_at) : null;
  }

  create(
    id: string,
    text: string,
    addressee: LiveQuestionAddressee | null,
    releaseAt: string,
    by: Operator,
    at: string,
  ): void {
    this.sql.exec(
      `INSERT INTO prepared_questions(id, body, addressed_to_credit_key, addressed_to_user_id, release_at,
         created_by_user_id, created_by_name, created_at, revision) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      id,
      text,
      addressee?.creditKey ?? null,
      addressee?.userId ?? null,
      releaseAt,
      by.userId,
      by.name,
      at,
    );
  }

  /** Rewrites a waiting question; it keeps its release moment. */
  update(id: string, text: string, addressee: LiveQuestionAddressee | null): void {
    this.sql.exec(
      `UPDATE prepared_questions SET body = ?, addressed_to_credit_key = ?, addressed_to_user_id = ?,
         revision = revision + 1 WHERE id = ?`,
      text,
      addressee?.creditKey ?? null,
      addressee?.userId ?? null,
      id,
    );
  }

  reschedule(id: string, releaseAt: string): void {
    this.sql.exec("UPDATE prepared_questions SET release_at = ? WHERE id = ?", releaseAt, id);
  }

  delete(id: string): void {
    this.sql.exec("DELETE FROM prepared_questions WHERE id = ?", id);
  }

  /** The window operators set, else the session's default one. */
  window(session: LiveRoomSession): LivePreparedQuestionWindow {
    const [row] = this.sql.rows<{ value_json: string }>(
      "SELECT value_json FROM room_controls WHERE name = ?",
      WINDOW_CONTROL,
    );
    const saved = row ? livePreparedQuestionWindowSchema.safeParse(JSON.parse(row.value_json)) : null;
    return saved?.success ? saved.data : defaultLivePreparedQuestionWindow(session.startAt, session.endAt);
  }

  saveWindow(window: LivePreparedQuestionWindow): void {
    this.sql.exec(
      "INSERT INTO room_controls(name, value_json) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET value_json = excluded.value_json",
      WINDOW_CONTROL,
      JSON.stringify(livePreparedQuestionWindowSchema.parse(window)),
    );
  }

  /** Removes the waiting questions an erased operator wrote; returns whether any were removed. */
  forget(userId: string): boolean {
    const removed = this.sql.rows("SELECT id FROM prepared_questions WHERE created_by_user_id = ?", userId).length;
    this.sql.exec("DELETE FROM prepared_questions WHERE created_by_user_id = ?", userId);
    return removed > 0;
  }
}
