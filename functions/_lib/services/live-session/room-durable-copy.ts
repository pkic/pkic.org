import type { DatabaseLike, StatementLike } from "../../types";
import type { ClassifierRun } from "../classifiers/model";
import { prepareDeleteClassifierResult, prepareStoreClassifierResult } from "../classifiers/results";
import { nowIso } from "../../utils/time";
import { prepareScopedAuditLog } from "../audit";
import { prepareLiveRoomCopyErasureGuard } from "./room-erasure";
import type { LivePollCopy } from "./room-poll-store";
import type { LiveQuestionRow } from "./room-question-rows";
import type { LiveQuestionCheckCopyRow } from "./room-question-checks";
import type { LiveAnswerCopyRow, LiveRoomPendingCopy } from "./room-store";

function prepareQuestionCopy(db: DatabaseLike, copy: LiveRoomPendingCopy, question: LiveQuestionRow, copiedAt: string) {
  // A question whose author was anonymized keeps its redaction: the copy never writes their words back.
  return db
    .prepare(
      `INSERT INTO event_session_questions(id,event_id,occurrence_id,author_user_id,anonymous,body,status,vote_count,asked_at,answered_at,moderated_by,moderated_at,display_text,rewritten_by,rewritten_at,removed_reason,done_at,prepared,addressed_to_user_id,copied_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET body=CASE WHEN event_session_questions.redacted_at IS NULL THEN excluded.body ELSE event_session_questions.body END,
         status=excluded.status,vote_count=excluded.vote_count,answered_at=excluded.answered_at,
         moderated_by=excluded.moderated_by,moderated_at=excluded.moderated_at,
         display_text=CASE WHEN event_session_questions.redacted_at IS NULL THEN excluded.display_text END,
         rewritten_by=excluded.rewritten_by,rewritten_at=excluded.rewritten_at,removed_reason=excluded.removed_reason,
         done_at=excluded.done_at,prepared=excluded.prepared,addressed_to_user_id=excluded.addressed_to_user_id,
         copied_at=excluded.copied_at`,
    )
    .bind(
      question.id,
      copy.eventId,
      copy.occurrenceId,
      question.author_user_id,
      question.anonymous,
      question.body,
      question.status,
      question.votes,
      question.asked_at,
      question.answered_at,
      question.author_withdrawn ? null : question.moderated_by_user_id,
      question.author_withdrawn ? null : question.moderated_at,
      question.rewrite_text,
      question.rewritten_by_user_id,
      question.rewritten_at,
      question.status === "hidden" ? question.removal_reason : null,
      question.done_at,
      question.prepared,
      question.addressed_to_user_id,
      copiedAt,
    );
}

/** What the check found for a question's words, beside the question; words that went unchecked drop the old result. */
function prepareQuestionCheckCopy(db: DatabaseLike, check: LiveQuestionCheckCopyRow) {
  return check.run_json
    ? prepareStoreClassifierResult(
        db,
        "question",
        check.question_id,
        JSON.parse(check.run_json) as ClassifierRun,
        check.at,
      )
    : prepareDeleteClassifierResult(db, "question", check.question_id);
}

/** An answer reaches D1 only while its question is there; a redacted answer keeps its redaction. */
function prepareAnswerCopy(db: DatabaseLike, copy: LiveRoomPendingCopy, answer: LiveAnswerCopyRow, copiedAt: string) {
  return db
    .prepare(
      `INSERT INTO event_session_question_answers(id,event_id,occurrence_id,question_id,author_user_id,body,created_at,vote_count,
         accepted_by,accepted_at,hidden_by,hidden_at,removed_reason,copied_at)
       SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM event_session_questions WHERE id=?)
       ON CONFLICT(id) DO UPDATE SET body=CASE WHEN event_session_question_answers.redacted_at IS NULL THEN excluded.body
           ELSE event_session_question_answers.body END,
         vote_count=excluded.vote_count,accepted_by=excluded.accepted_by,accepted_at=excluded.accepted_at,
         hidden_by=excluded.hidden_by,hidden_at=excluded.hidden_at,removed_reason=excluded.removed_reason,
         copied_at=excluded.copied_at`,
    )
    .bind(
      answer.id,
      copy.eventId,
      copy.occurrenceId,
      answer.question_id,
      answer.author_user_id,
      answer.body,
      answer.created_at,
      answer.vote_count,
      answer.accepted_by_user_id,
      answer.accepted_at,
      answer.hidden_by,
      answer.hidden_at,
      answer.removed_reason,
      copiedAt,
      answer.question_id,
    );
}

/**
 * A poll as reporting reads it: its question as the form field it was asked
 * as, how many answered, and the count per answer value. The tallies are
 * replaced as a whole, so an answer withdrawn by an erasure leaves no count.
 */
function preparePollCopy(db: DatabaseLike, copy: LiveRoomPendingCopy, poll: LivePollCopy, copiedAt: string) {
  return [
    db
      .prepare(
        `INSERT INTO event_session_polls(id,event_id,occurrence_id,field_json,show_results,status,respondents,created_by,created_at,opened_by,opened_at,closed_by,closed_at,copied_at)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET field_json=excluded.field_json,show_results=excluded.show_results,
           status=excluded.status,respondents=excluded.respondents,opened_by=excluded.opened_by,
           opened_at=excluded.opened_at,closed_by=excluded.closed_by,closed_at=excluded.closed_at,copied_at=excluded.copied_at`,
      )
      .bind(
        poll.id,
        copy.eventId,
        copy.occurrenceId,
        JSON.stringify(poll.field),
        poll.show_results,
        poll.status,
        poll.respondents,
        poll.created_by_user_id,
        poll.created_at,
        poll.opened_by_user_id,
        poll.opened_at,
        poll.closed_by_user_id,
        poll.closed_at,
        copiedAt,
      ),
    db.prepare("DELETE FROM event_session_poll_tallies WHERE poll_id=?").bind(poll.id),
    ...[...poll.tallies].map(([value, votes]) =>
      db
        .prepare("INSERT INTO event_session_poll_tallies(poll_id,value,vote_count) VALUES(?,?,?)")
        .bind(poll.id, value, votes),
    ),
  ];
}

/**
 * Writes a room's changes since its last copy to D1 as one atomic batch:
 * the changed questions with what the check found for them, opened or closed polls with their tallies (never who
 * voted for what), reaction and chat totals (never message text), and the audit rows for the staff actions
 * taken meanwhile. Every statement is an upsert or an idempotent insert keyed
 * by the room's own sequence, so the room's alarm may retry a batch whose
 * outcome it never learned without duplicating anything.
 */
export async function copyLiveRoomToD1(db: DatabaseLike, copy: LiveRoomPendingCopy): Promise<void> {
  const copiedAt = nowIso();
  const statements: StatementLike[] = [
    ...copy.questions.map((question) => prepareQuestionCopy(db, copy, question, copiedAt)),
    ...copy.questionChecks.map((check) => prepareQuestionCheckCopy(db, check)),
    ...copy.answers.map((answer) => prepareAnswerCopy(db, copy, answer, copiedAt)),
    ...copy.polls.flatMap((poll) => preparePollCopy(db, copy, poll, copiedAt)),
    ...copy.reactions.map((reaction) =>
      db
        .prepare(
          `INSERT INTO event_session_reaction_totals(event_id,occurrence_id,reaction,total,copied_at) VALUES(?,?,?,?,?)
           ON CONFLICT(event_id,occurrence_id,reaction) DO UPDATE SET total=excluded.total,copied_at=excluded.copied_at`,
        )
        .bind(copy.eventId, copy.occurrenceId, reaction.reaction, reaction.total, copiedAt),
    ),
    ...copy.staffActions.map((action) =>
      prepareScopedAuditLog(
        db,
        { type: "event", id: copy.eventId },
        "user",
        action.actor_user_id,
        action.action,
        "event_agenda_occurrence",
        copy.occurrenceId,
        JSON.parse(action.details_json) as Record<string, unknown>,
        action.occurred_at,
        `live-session:${copy.eventId}:${copy.occurrenceId}:${action.seq}`,
      ),
    ),
  ];
  if (!statements.length) return;
  if (copy.questions.length || copy.answers.length)
    statements.push(...prepareLiveRoomCopyErasureGuard(db, copy.eventId, copy.occurrenceId, copiedAt));
  await db.batch(statements);
}
