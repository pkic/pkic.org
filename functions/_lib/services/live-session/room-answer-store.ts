import { LIVE_QUESTION_ANSWER_POLICY } from "../../../../assets/shared/live-session-policy";
import type { LiveRoomSql } from "./room-sql";

export interface LiveAnswerRow {
  id: string;
  question_id: string;
  author_user_id: string;
  author_name: string;
  body: string;
  author_json: string;
  created_at: string;
  revision: number;
  accepted_by_user_id: string | null;
  accepted_by_name: string | null;
  accepted_at: string | null;
  last_decision_operation_id: string | null;
  last_decision_actor_id: string | null;
  last_decision_accepted: number | null;
  last_decision_basis_revision: number | null;
  votes: number;
}
const COLUMNS = `id,question_id,author_user_id,author_name,body,author_json,created_at,revision,
  accepted_by_user_id,accepted_by_name,accepted_at,last_decision_operation_id,last_decision_actor_id,
  last_decision_accepted,last_decision_basis_revision,
  (SELECT COUNT(*) FROM question_answer_votes v WHERE v.answer_id=question_answers.id) AS votes`;

/** Answers share the room's SQLite lifetime; no second live writer or unbounded history copy. */
export class LiveRoomAnswerStore {
  constructor(private readonly sql: LiveRoomSql) {}

  answer(id: string): LiveAnswerRow | null {
    return this.sql.rows<LiveAnswerRow>(`SELECT ${COLUMNS} FROM question_answers WHERE id=?`, id)[0] ?? null;
  }

  /** A thread in reading order: the accepted answer first, then the most upvoted, then the oldest. */
  answers(questionId: string): LiveAnswerRow[] {
    return this.sql.rows<LiveAnswerRow>(
      `SELECT ${COLUMNS} FROM question_answers WHERE question_id=?
       ORDER BY accepted_at IS NULL, votes DESC, created_at, id LIMIT ?`,
      questionId,
      LIVE_QUESTION_ANSWER_POLICY.maxAnswersPerQuestion,
    );
  }

  /** A thread is bounded to 25 replies; include its asker and every stored decision attribution. */
  participants(questionId: string): string[] {
    return this.sql
      .rows<{ id: string }>(
        `SELECT author_user_id AS id FROM question_answers WHERE question_id=?
       UNION SELECT accepted_by_user_id FROM question_answers WHERE question_id=? AND accepted_by_user_id IS NOT NULL
       UNION SELECT last_decision_actor_id FROM question_answers WHERE question_id=? AND last_decision_actor_id IS NOT NULL
       UNION SELECT author_user_id FROM questions WHERE id=?`,
        questionId,
        questionId,
        questionId,
        questionId,
      )
      .map((row) => row.id);
  }

  canAdd(questionId: string, userId: string, at: string): "full" | "tooFast" | null {
    const [counts] = this.sql.rows<{ room: number; question: number; recent: number }>(
      `SELECT COUNT(*) AS room, COUNT(CASE WHEN question_id=? THEN 1 END) AS question,
        COUNT(CASE WHEN author_user_id=? AND created_at>=? THEN 1 END) AS recent FROM question_answers`,
      questionId,
      userId,
      new Date(Date.parse(at) - LIVE_QUESTION_ANSWER_POLICY.perPerson.windowSeconds * 1000).toISOString(),
    );
    if (
      counts.room >= LIVE_QUESTION_ANSWER_POLICY.maxAnswersPerRoom ||
      counts.question >= LIVE_QUESTION_ANSWER_POLICY.maxAnswersPerQuestion
    )
      return "full";
    return counts.recent >= LIVE_QUESTION_ANSWER_POLICY.perPerson.limit ? "tooFast" : null;
  }

  add(
    row: Pick<
      LiveAnswerRow,
      "id" | "question_id" | "author_user_id" | "author_name" | "body" | "author_json" | "created_at"
    >,
  ): void {
    this.sql.exec(
      "INSERT INTO question_answers(id,question_id,author_user_id,author_name,body,author_json,created_at) VALUES (?,?,?,?,?,?,?)",
      row.id,
      row.question_id,
      row.author_user_id,
      row.author_name,
      row.body,
      row.author_json,
      row.created_at,
    );
    this.changed(row.id);
  }

  /** Which of these answers one person upvoted. */
  votedBy(userId: string | null, answerIds: readonly string[]): Set<string> {
    if (!userId || !answerIds.length) return new Set();
    return new Set(
      this.sql
        .rows<{ answer_id: string }>(
          "SELECT answer_id FROM question_answer_votes WHERE user_id=? AND answer_id IN (SELECT value FROM json_each(?))",
          userId,
          JSON.stringify(answerIds),
        )
        .map((row) => row.answer_id),
    );
  }

  vote(answerId: string, userId: string, voted: boolean): void {
    if (voted)
      this.sql.exec("INSERT OR IGNORE INTO question_answer_votes(answer_id,user_id) VALUES (?,?)", answerId, userId);
    else this.sql.exec("DELETE FROM question_answer_votes WHERE answer_id=? AND user_id=?", answerId, userId);
    this.changed(answerId);
  }

  /** Marks an answer for the durable copy. */
  changed(answerId: string): void {
    this.sql.exec(
      "INSERT INTO question_answer_changes(answer_id,change_seq) VALUES (?,?) ON CONFLICT(answer_id) DO UPDATE SET change_seq=excluded.change_seq",
      answerId,
      this.sql.nextChange(),
    );
  }

  /** Answers of one person in this room, for removing their posts with a block. */
  byAuthor(userId: string): LiveAnswerRow[] {
    return this.sql.rows<LiveAnswerRow>(
      `SELECT ${COLUMNS} FROM question_answers WHERE author_user_id=? LIMIT ?`,
      userId,
      LIVE_QUESTION_ANSWER_POLICY.maxAnswersPerRoom,
    );
  }

  /** Accepting one answer replaces the question's earlier accepted answer. */
  accept(
    row: LiveAnswerRow,
    actor: { userId: string; name: string },
    operationId: string,
    accepted: boolean,
    at: string,
  ): void {
    this.sql.exec(
      `UPDATE question_answers SET revision=revision+1,accepted_by_user_id=?,accepted_by_name=?,accepted_at=?,
        last_decision_operation_id=?,last_decision_actor_id=?,last_decision_accepted=?,last_decision_basis_revision=?
       WHERE id=? AND revision=?`,
      accepted ? actor.userId : null,
      accepted ? actor.name : null,
      accepted ? at : null,
      operationId,
      actor.userId,
      accepted ? 1 : 0,
      row.revision,
      row.id,
      row.revision,
    );
    this.changed(row.id);
    if (!accepted) return;
    const replaced = this.sql.rows<{ id: string }>(
      "SELECT id FROM question_answers WHERE question_id=? AND id<>? AND accepted_at IS NOT NULL",
      row.question_id,
      row.id,
    );
    for (const { id } of replaced) {
      this.sql.exec(
        "UPDATE question_answers SET revision=revision+1,accepted_by_user_id=NULL,accepted_by_name=NULL,accepted_at=NULL WHERE id=?",
        id,
      );
      this.changed(id);
    }
  }

  authors(): string[] {
    return this.sql
      .rows<{ author_user_id: string }>("SELECT DISTINCT author_user_id FROM question_answers")
      .map((row) => row.author_user_id);
  }

  /** Remove replies on erased questions, the person's replies and attribution to their acceptance decisions. */
  forget(userId: string): string[] {
    const changed = this.sql
      .rows<{ question_id: string }>(
        `SELECT DISTINCT question_id FROM question_answers WHERE author_user_id=? OR accepted_by_user_id=? OR last_decision_actor_id=?
       OR question_id IN (SELECT id FROM questions WHERE author_user_id=?) LIMIT ?`,
        userId,
        userId,
        userId,
        userId,
        LIVE_QUESTION_ANSWER_POLICY.maxAnswersPerRoom,
      )
      .map((row) => row.question_id);
    const gone = `SELECT id FROM question_answers WHERE author_user_id=? OR question_id IN (SELECT id FROM questions WHERE author_user_id=?)`;
    const recount = this.sql
      .rows<{ answer_id: string }>(
        `SELECT answer_id FROM question_answer_votes WHERE user_id=? AND answer_id NOT IN (${gone})`,
        userId,
        userId,
        userId,
      )
      .map((row) => row.answer_id);
    this.sql.exec(
      `DELETE FROM question_answer_votes WHERE user_id=? OR answer_id IN (${gone})`,
      userId,
      userId,
      userId,
    );
    this.sql.exec(`DELETE FROM question_answer_changes WHERE answer_id IN (${gone})`, userId, userId);
    this.sql.exec(
      "DELETE FROM question_answers WHERE author_user_id=? OR question_id IN (SELECT id FROM questions WHERE author_user_id=?)",
      userId,
      userId,
    );
    this.sql.exec(
      `UPDATE question_answers SET accepted_by_user_id=CASE WHEN accepted_by_user_id=? THEN NULL ELSE accepted_by_user_id END,
        accepted_by_name=CASE WHEN accepted_by_user_id=? THEN 'Former participant' ELSE accepted_by_name END,
        last_decision_actor_id=NULL,last_decision_operation_id=NULL,revision=revision+1
       WHERE accepted_by_user_id=? OR last_decision_actor_id=?`,
      userId,
      userId,
      userId,
      userId,
    );
    // The durable copy's vote counts drop the person's votes on answers that stay.
    for (const answerId of recount) this.changed(answerId);
    return changed;
  }
}
