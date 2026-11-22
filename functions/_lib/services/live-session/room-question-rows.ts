/**
 * A room question as the room's SQLite reads it: one row joining the asker's
 * words and changes, the moderation on it, its answers and the asker's block.
 */
import type { LiveModerationReason, LiveParticipationBlock } from "../../../../assets/shared/live-moderation-policy";
import type { LiveQuestionStatus } from "../../../../assets/shared/live-session-policy";

export interface LiveQuestionAuthorChangeRow {
  question_id: string;
  text: string;
  revision: number;
  withdrawn: number;
  operation_id: string;
  operation_type: "question.edit" | "question.withdraw";
  basis_revision: number;
  changed_at: string;
}

export interface LiveQuestionRow {
  id: string;
  author_user_id: string;
  author_name: string;
  anonymous: number;
  body: string;
  submitted_body: string;
  author_revision: number;
  author_withdrawn: number;
  status: LiveQuestionStatus;
  votes: number;
  asked_at: string;
  answered_at: string | null;
  moderated_by_user_id: string | null;
  moderated_by_name: string | null;
  moderated_at: string | null;
  rewrite_text: string | null;
  rewritten_by_user_id: string | null;
  rewritten_by_name: string | null;
  rewritten_at: string | null;
  /** The author's profile photo as they asked; the projection withholds it from an anonymous question. */
  author_photo_url: string | null;
  /** Who the author was as they asked (`LiveAuthorStamp` JSON); withheld like the photo from an anonymous question. */
  author_json: string | null;
  /** The credit key of the person the question is for; null when it is for everyone. */
  addressed_to: string | null;
  /** The account of that person, when their credit has one; reporting reads it. */
  addressed_to_user_id: string | null;
  /** 1 when operators prepared the question; only operators are told. */
  prepared: number;
  change_seq: number;
  /** Answers nobody removed. */
  answer_count: number;
  accepted_answer: number;
  removal_reason: LiveModerationReason | null;
  removal_at: string | null;
  removal_by_name: string | null;
  done_at: string | null;
  done_by_name: string | null;
  author_block: LiveParticipationBlock | null;
  author_block_until: string | null;
}

/** The person a question is for: a session credit's key and, when the credit names one, their account. */
export interface LiveQuestionAddressee {
  creditKey: string;
  userId: string | null;
}

export const LIVE_QUESTION_SELECT = `SELECT q.id, q.author_user_id, q.author_name, q.anonymous, COALESCE(author_change.text,q.body) AS body, q.body AS submitted_body,
  COALESCE(author_change.revision,0) AS author_revision, COALESCE(author_change.withdrawn,0) AS author_withdrawn, q.status, q.votes, q.asked_at,
  q.answered_at, q.moderated_by_user_id, q.moderated_by_name, q.moderated_at, r.text AS rewrite_text,
  r.by_user_id AS rewritten_by_user_id, r.by_name AS rewritten_by_name, r.at AS rewritten_at,
  photo.photo_url AS author_photo_url, authorship.author_json, addressee.credit_key AS addressed_to,
  addressee.user_id AS addressed_to_user_id, CASE WHEN prepared.question_id IS NULL THEN 0 ELSE 1 END AS prepared, q.change_seq,
  (SELECT COUNT(*) FROM question_answers a WHERE a.question_id = q.id
    AND a.id NOT IN (SELECT item_id FROM room_removals WHERE kind = 'answer')) AS answer_count,
  EXISTS (SELECT 1 FROM question_answers a WHERE a.question_id = q.id AND a.accepted_at IS NOT NULL
    AND a.id NOT IN (SELECT item_id FROM room_removals WHERE kind = 'answer')) AS accepted_answer,
  removal.reason AS removal_reason, removal.at AS removal_at, removal.by_name AS removal_by_name,
  done.at AS done_at, done.by_name AS done_by_name,
  CASE WHEN event_block.user_id IS NOT NULL THEN 'event' ELSE block.block END AS author_block,
  CASE WHEN event_block.user_id IS NOT NULL THEN NULL ELSE block.until END AS author_block_until
  FROM questions q LEFT JOIN question_rewrites r ON r.question_id = q.id
  LEFT JOIN question_addressees addressee ON addressee.question_id = q.id
  LEFT JOIN question_prepared prepared ON prepared.question_id = q.id
  LEFT JOIN room_removals removal ON removal.item_id = q.id
  LEFT JOIN room_done done ON done.item_id = q.id
  LEFT JOIN room_participation_blocks block ON block.user_id = q.author_user_id
  LEFT JOIN room_event_blocks event_block ON event_block.user_id = q.author_user_id
  LEFT JOIN question_author_photos photo ON photo.question_id = q.id
  LEFT JOIN question_authorship authorship ON authorship.question_id = q.id
  LEFT JOIN question_author_changes author_change ON author_change.question_id = q.id`;
