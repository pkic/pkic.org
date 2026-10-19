/**
 * A room's own SQLite schema, the live source of truth while the session runs.
 * Every mutation is synchronous, so each socket message commits atomically.
 * `change_seq` marks rows changed since the last durable copy to D1.
 *
 * Tables are only ever added here, never altered: a room created by an
 * earlier release keeps its tables and gains the new ones on its next start.
 * A poll is a form question, so its tables are `session_poll*`; the earlier
 * per-option `polls` tables a room may still hold are no longer read, and go
 * with the rest of its storage when the room is purged.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS room_chat (id TEXT PRIMARY KEY,author_user_id TEXT NOT NULL,author_name TEXT NOT NULL,body TEXT NOT NULL,sent_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS room_chat_sent_at ON room_chat(sent_at,id);
CREATE TABLE IF NOT EXISTS room_operator_chat (id TEXT PRIMARY KEY,author_user_id TEXT NOT NULL,author_name TEXT NOT NULL,body TEXT NOT NULL,sent_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS room_operator_chat_sent_at ON room_operator_chat(sent_at,id);
CREATE TABLE IF NOT EXISTS room_chat_limits (user_id TEXT PRIMARY KEY,sent_times_json TEXT NOT NULL,last_sent_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS room_chat_author ON room_chat(author_user_id);
CREATE INDEX IF NOT EXISTS room_operator_chat_author ON room_operator_chat(author_user_id);
CREATE TABLE IF NOT EXISTS room_chat_reactions (message_id TEXT NOT NULL,user_id TEXT NOT NULL,reaction TEXT NOT NULL,PRIMARY KEY(message_id,user_id,reaction));
CREATE INDEX IF NOT EXISTS room_chat_reactions_user ON room_chat_reactions(user_id);
CREATE TABLE IF NOT EXISTS room_chat_reports (message_id TEXT NOT NULL,user_id TEXT NOT NULL,reason TEXT NOT NULL,reported_at TEXT NOT NULL,PRIMARY KEY(message_id,user_id));
CREATE INDEX IF NOT EXISTS room_chat_reports_user ON room_chat_reports(user_id);
CREATE TABLE IF NOT EXISTS room_chat_hidden (message_id TEXT PRIMARY KEY,held INTEGER NOT NULL,by_name TEXT NOT NULL,at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS room_chat_questions (message_id TEXT PRIMARY KEY,question_id TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS room_chat_restrictions (user_id TEXT PRIMARY KEY,restriction TEXT NOT NULL,by_name TEXT NOT NULL,at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS room_people (user_id TEXT PRIMARY KEY,handle TEXT,photo_url TEXT,staff INTEGER NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS room_people_handle ON room_people(handle);
CREATE TABLE IF NOT EXISTS room_chat_authorship (message_id TEXT PRIMARY KEY,author_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS question_authorship (question_id TEXT PRIMARY KEY,author_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS room_session (id INTEGER PRIMARY KEY CHECK(id=1), event_id TEXT NOT NULL, session_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS questions (
  id TEXT PRIMARY KEY, author_user_id TEXT NOT NULL, author_name TEXT NOT NULL, anonymous INTEGER NOT NULL,
  body TEXT NOT NULL, status TEXT NOT NULL, votes INTEGER NOT NULL DEFAULT 0, asked_at TEXT NOT NULL,
  answered_at TEXT, moderated_by_user_id TEXT, moderated_by_name TEXT, moderated_at TEXT, change_seq INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS questions_top ON questions(votes DESC, asked_at DESC, id);
CREATE INDEX IF NOT EXISTS questions_changes ON questions(change_seq);
CREATE INDEX IF NOT EXISTS questions_author ON questions(author_user_id);
CREATE TABLE IF NOT EXISTS question_write_times (id TEXT PRIMARY KEY,user_id TEXT NOT NULL,accepted_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS question_write_times_user ON question_write_times(user_id,accepted_at);
CREATE INDEX IF NOT EXISTS question_write_times_expiry ON question_write_times(accepted_at);
CREATE TABLE IF NOT EXISTS question_author_changes (
  question_id TEXT PRIMARY KEY, text TEXT NOT NULL, revision INTEGER NOT NULL,
  withdrawn INTEGER NOT NULL, operation_id TEXT NOT NULL, operation_type TEXT NOT NULL,
  basis_revision INTEGER NOT NULL, changed_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS question_answers (
  id TEXT PRIMARY KEY, question_id TEXT NOT NULL, author_user_id TEXT NOT NULL,
  author_name TEXT NOT NULL, body TEXT NOT NULL, author_json TEXT NOT NULL, created_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0, accepted_by_user_id TEXT, accepted_by_name TEXT, accepted_at TEXT,
  last_decision_operation_id TEXT, last_decision_actor_id TEXT, last_decision_accepted INTEGER,
  last_decision_basis_revision INTEGER);
CREATE INDEX IF NOT EXISTS question_answers_question ON question_answers(question_id,created_at,id);
CREATE INDEX IF NOT EXISTS question_answers_author ON question_answers(author_user_id,created_at);
CREATE TABLE IF NOT EXISTS question_votes (question_id TEXT NOT NULL, user_id TEXT NOT NULL, PRIMARY KEY(question_id, user_id));
CREATE INDEX IF NOT EXISTS question_votes_user ON question_votes(user_id);
CREATE TABLE IF NOT EXISTS question_author_photos (question_id TEXT PRIMARY KEY, photo_url TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS question_rewrites (
  question_id TEXT PRIMARY KEY, text TEXT NOT NULL, by_user_id TEXT NOT NULL, by_name TEXT NOT NULL, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS session_polls (
  id TEXT PRIMARY KEY, field_json TEXT NOT NULL, show_results INTEGER NOT NULL, status TEXT NOT NULL,
  respondents INTEGER NOT NULL DEFAULT 0, created_by_user_id TEXT NOT NULL, created_at TEXT NOT NULL,
  opened_at TEXT, opened_by_user_id TEXT, closed_at TEXT, closed_by_user_id TEXT,
  changed_by_name TEXT NOT NULL, changed_at TEXT NOT NULL, change_seq INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS session_polls_changes ON session_polls(change_seq);
CREATE TABLE IF NOT EXISTS session_poll_tallies (
  poll_id TEXT NOT NULL, value TEXT NOT NULL, votes INTEGER NOT NULL, PRIMARY KEY(poll_id, value));
CREATE TABLE IF NOT EXISTS session_poll_ballots (
  poll_id TEXT NOT NULL, user_id TEXT NOT NULL, answer_json TEXT NOT NULL, PRIMARY KEY(poll_id, user_id));
CREATE INDEX IF NOT EXISTS session_poll_ballots_user ON session_poll_ballots(user_id);
CREATE TABLE IF NOT EXISTS reaction_totals (reaction TEXT PRIMARY KEY, total INTEGER NOT NULL, change_seq INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS room_controls (name TEXT PRIMARY KEY, value_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS staff_actions (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, actor_user_id TEXT NOT NULL, action TEXT NOT NULL, details_json TEXT NOT NULL, occurred_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS copy_state (id INTEGER PRIMARY KEY CHECK(id=1), change_seq INTEGER NOT NULL, copied_seq INTEGER NOT NULL);
INSERT OR IGNORE INTO copy_state(id, change_seq, copied_seq) VALUES (1, 0, 0);
`;

type Row = Record<string, ArrayBuffer | string | number | null>;

/** The part of a Durable Object's SQL storage the room uses. */
export interface RoomSqlStorage {
  exec(query: string, ...bindings: unknown[]): { toArray(): Row[] };
}

/**
 * The room's SQL access. The schema is created on first use, so a purged
 * room stays empty until something writes to it again.
 */
export class LiveRoomSql {
  private ready = false;

  constructor(private readonly sql: RoomSqlStorage) {}

  private ensure(): RoomSqlStorage {
    if (!this.ready) {
      this.sql.exec(SCHEMA);
      // The speaker-facing output is the stage display now, and the overlay mode names the switcher, not a product.
      this.sql.exec(
        `UPDATE room_controls SET name='aux:stage-display' WHERE name='aux:stage-timer' AND NOT EXISTS (SELECT 1 FROM room_controls WHERE name='aux:stage-display')`,
      );
      this.sql.exec(`UPDATE room_controls SET value_json='"switcher"' WHERE name='overlayMode' AND value_json='"obs"'`);
      // Stored compositions move once to the plural timer contract; socket commands have no old-field alias.
      for (const root of ["$", "$.stage"]) {
        const timer = `${root}.timer`;
        this.sql.exec(
          `UPDATE room_controls SET value_json = json_remove(json_set(value_json, ?, json(
            CASE WHEN json_type(value_json, ?) = 'object' THEN
              json_array(json(CASE WHEN json_extract(value_json, ?) = 'h:mm:ss'
                THEN json_set(json_extract(value_json, ?), '$.format', 'hh:mm:ss')
                ELSE json_extract(value_json, ?) END))
              ELSE '[]' END)), ?)
           WHERE (name IN ('stage', 'preview', 'programUndo') OR name LIKE 'aux:%')
             AND json_type(value_json, ?) IN ('object', 'null')`,
          `${root}.timerGraphics`,
          timer,
          `${timer}.format`,
          timer,
          timer,
          timer,
          timer,
        );
      }
      this.ready = true;
    }
    return this.sql;
  }

  rows<T>(query: string, ...bindings: unknown[]): T[] {
    return this.ensure()
      .exec(query, ...bindings)
      .toArray() as T[];
  }

  exec(query: string, ...bindings: unknown[]): void {
    this.ensure().exec(query, ...bindings);
  }

  /** The next change number; every changed row carries it until the durable copy passes it. */
  nextChange(): number {
    return this.rows<{ change_seq: number }>(
      "UPDATE copy_state SET change_seq = change_seq + 1 WHERE id = 1 RETURNING change_seq",
    )[0].change_seq;
  }

  /** Whether the room holds anything at all, without creating its schema to find out. */
  holdsData(): boolean {
    return (
      this.ready ||
      this.sql.exec("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'room_session'").toArray().length > 0
    );
  }

  /** Forgets that the schema exists, after the room's storage was erased. */
  erased(): void {
    this.ready = false;
  }
}
