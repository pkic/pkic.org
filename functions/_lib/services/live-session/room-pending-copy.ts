import type { LiveModerationReason } from "../../../../assets/shared/live-moderation-policy";
import type { LiveRoomSession } from "../../../../assets/shared/schemas/live-session-room";
import { copyableLivePolls, type LivePollCopy } from "./room-poll-store";
import { LIVE_QUESTION_SELECT, type LiveQuestionRow } from "./room-question-rows";
import type { LiveQuestionCheckCopyRow, LiveQuestionCheckStore } from "./room-question-checks";
import type { LiveRoomSql } from "./room-sql";

export interface LiveStaffActionRow {
  seq: number;
  actor_user_id: string;
  action: string;
  details_json: string;
  occurred_at: string;
}

/** Everything changed since the last durable copy. */
export interface LiveRoomPendingCopy {
  eventId: string;
  occurrenceId: string;
  throughSeq: number;
  questions: LiveQuestionRow[];
  polls: LivePollCopy[];
  reactions: Array<{ reaction: string; total: number }>;
  answers: LiveAnswerCopyRow[];
  /** What the check found for each question's current words; a null run means the new words went unchecked. */
  questionChecks: LiveQuestionCheckCopyRow[];
  staffActions: LiveStaffActionRow[];
}

/** An answer as reporting reads it: who wrote and accepted it, its votes, and whether a moderator removed it. */
export interface LiveAnswerCopyRow {
  id: string;
  question_id: string;
  author_user_id: string;
  body: string;
  created_at: string;
  vote_count: number;
  accepted_by_user_id: string | null;
  accepted_at: string | null;
  hidden_by: string | null;
  hidden_at: string | null;
  removed_reason: LiveModerationReason | null;
}

/** Reads everything the room changed since its last durable copy; null when nothing waits. */
export function readLiveRoomPendingCopy(
  sql: LiveRoomSql,
  room: { eventId: string; session: LiveRoomSession },
  questionChecks: LiveQuestionCheckStore,
): LiveRoomPendingCopy | null {
  const [{ change_seq: throughSeq, copied_seq: copiedSeq }] = sql.rows<{
    change_seq: number;
    copied_seq: number;
  }>("SELECT change_seq, copied_seq FROM copy_state WHERE id = 1");
  const staffActions = sql.rows<LiveStaffActionRow>(
    "SELECT seq, actor_user_id, action, details_json, occurred_at FROM staff_actions ORDER BY seq",
  );
  if (throughSeq === copiedSeq && staffActions.length === 0) return null;
  return {
    eventId: room.eventId,
    occurrenceId: room.session.occurrenceId,
    throughSeq,
    questions: sql.rows<LiveQuestionRow>(
      `${LIVE_QUESTION_SELECT} WHERE q.change_seq > ? ORDER BY q.change_seq`,
      copiedSeq,
    ),
    polls: copyableLivePolls(sql, copiedSeq),
    reactions: sql.rows("SELECT reaction, total FROM reaction_totals WHERE change_seq > ?", copiedSeq),
    answers: sql.rows<LiveAnswerCopyRow>(
      `SELECT a.id, a.question_id, a.author_user_id, a.body, a.created_at,
         (SELECT COUNT(*) FROM question_answer_votes v WHERE v.answer_id = a.id) AS vote_count,
         a.accepted_by_user_id, a.accepted_at, removal.by_user_id AS hidden_by, removal.at AS hidden_at,
         removal.reason AS removed_reason
       FROM question_answer_changes change JOIN question_answers a ON a.id = change.answer_id
       LEFT JOIN room_removals removal ON removal.item_id = a.id
       WHERE change.change_seq > ? ORDER BY change.change_seq`,
      copiedSeq,
    ),
    questionChecks: questionChecks.copyable(copiedSeq),
    staffActions,
  };
}
