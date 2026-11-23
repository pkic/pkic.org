/**
 * The classifier of each question's current words, kept in the room: the flag moderators see, and the whole
 * run, which reaches D1 with the question so the check can be tuned after the room is gone.
 */
import type { LiveClassifierVerdict } from "../../../../assets/shared/schemas/live-session-moderation";
import type { ClassifierRun } from "../classifiers/model";
import type { LiveRoomSql } from "./room-sql";

/** A question's check result as the copy to D1 reads it; a null run means its new words went unchecked. */
export interface LiveQuestionCheckCopyRow {
  question_id: string;
  run_json: string | null;
  at: string;
}

export class LiveQuestionCheckStore {
  constructor(private readonly sql: LiveRoomSql) {}

  /** The check's flag on a question's current words; null clears it. */
  flag(questionId: string, check: LiveClassifierVerdict | null): void {
    if (!check) {
      this.sql.exec("DELETE FROM question_checks WHERE question_id = ?", questionId);
      return;
    }
    this.sql.exec(
      `INSERT INTO question_checks(question_id, outcome, notes_json) VALUES (?, ?, ?)
       ON CONFLICT(question_id) DO UPDATE SET outcome = excluded.outcome, notes_json = excluded.notes_json`,
      questionId,
      check.outcome,
      JSON.stringify(check.notes),
    );
  }

  /** Everything the check found for a question's current words, every answer and the model; null: unchecked. */
  record(questionId: string, run: ClassifierRun | null, at: string): void {
    this.sql.exec(
      `INSERT INTO question_check_results(question_id, run_json, at, change_seq) VALUES (?, ?, ?, ?)
       ON CONFLICT(question_id) DO UPDATE SET run_json = excluded.run_json, at = excluded.at, change_seq = excluded.change_seq`,
      questionId,
      run ? JSON.stringify(run) : null,
      at,
      this.sql.nextChange(),
    );
  }

  /** The results recorded since the room's last copy to D1. */
  copyable(copiedSeq: number): LiveQuestionCheckCopyRow[] {
    return this.sql.rows<LiveQuestionCheckCopyRow>(
      "SELECT question_id, run_json, at FROM question_check_results WHERE change_seq > ? ORDER BY change_seq",
      copiedSeq,
    );
  }
}
