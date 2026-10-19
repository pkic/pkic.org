import {
  canEditOwnLiveQuestion,
  livePollResultsVisible,
  PUBLIC_LIVE_QUESTION_STATUSES,
} from "../../../../assets/shared/live-session-policy";
import type { LivePoll } from "../../../../assets/shared/schemas/live-session-poll";
import type { CustomAnswerValue } from "../../../../assets/shared/form-answer-rules";
import { formFieldStatFromTallies } from "../../../../assets/shared/form-field-statistics";
import {
  liveRoomClientMessageSchema,
  liveRoomServerMessageSchema,
  type LiveRoomClientMessage,
  type LiveQuestion,
  type LiveRoomServerMessage,
} from "../../../../assets/shared/schemas/live-session-room";
import type { LiveRoomParticipant } from "./room-admission";
import type { LivePollRecord } from "./room-poll-store";
import type { LiveQuestionRow } from "./room-store";
import type { LiveAuthorAffiliation } from "../../../../assets/shared/schemas/live-session-author";
import type { LiveAuthorRole } from "../../../../assets/shared/live-author-roles";

/** A question's author as the room shows them. */
export interface LiveQuestionAuthor {
  handle: string | null;
  affiliation: LiveAuthorAffiliation | null;
  roles: LiveAuthorRole[];
}

/**
 * Who sees what. Moderators see every question with its author and any
 * rewrite's original; everyone else sees approved and answered questions,
 * plus their own in any status, and an anonymous author's name only on their
 * own question. Overlays see no list.
 */
export function projectLiveQuestion(
  row: LiveQuestionRow,
  viewer: LiveRoomParticipant,
  votedByMe: boolean,
  /** The author as the room shows them, under the same anonymity as their name. */
  author: LiveQuestionAuthor | null = null,
): LiveQuestion | null {
  if (viewer.role === "overlay") return null;
  const mine = viewer.userId !== null && row.author_user_id === viewer.userId;
  const operator = viewer.role === "operator";
  if (!operator && !mine && !PUBLIC_LIVE_QUESTION_STATUSES.includes(row.status)) return null;
  const anonymous = row.anonymous === 1;
  const named = operator || mine || !anonymous;
  return {
    id: row.id,
    text: row.rewrite_text ?? row.body,
    status: row.status,
    votes: row.votes,
    anonymous,
    authorName: named ? row.author_name : null,
    // A photo names the author as plainly as a name does: an anonymous question shows none, to anyone.
    authorPhotoUrl: anonymous ? null : row.author_photo_url,
    // An anonymous question never carries a handle, not even to moderators: its author cannot be looked up.
    authorHandle: !anonymous ? (author?.handle ?? null) : null,
    authorAffiliation: named ? (author?.affiliation ?? null) : null,
    authorRoles: named ? (author?.roles ?? []) : [],
    mine,
    revision: row.author_revision,
    withdrawn: row.author_withdrawn === 1,
    canEdit: canEditOwnLiveQuestion({
      mine,
      status: row.status,
      reviewed: row.moderated_at !== null || row.rewrite_text !== null,
      withdrawn: row.author_withdrawn === 1,
    }),
    votedByMe,
    askedAt: row.asked_at,
    answeredAt: row.answered_at,
    moderated:
      operator && !row.author_withdrawn && row.moderated_by_name && row.moderated_at
        ? { operatorName: row.moderated_by_name, at: row.moderated_at }
        : null,
    originalText: operator && row.rewrite_text !== null ? row.body : null,
    rewritten:
      operator && row.rewritten_by_name && row.rewritten_at
        ? { operatorName: row.rewritten_by_name, at: row.rewritten_at }
        : null,
  };
}

/**
 * A poll as one viewer may see it. Drafts are the operators' own; an overlay
 * sees only the poll on air; tallies follow the shared visibility rule.
 */
export function projectLivePoll(
  poll: LivePollRecord,
  viewer: LiveRoomParticipant,
  myAnswer: CustomAnswerValue | null,
  onAir: boolean,
): LivePoll | null {
  const operator = viewer.role === "operator";
  if (poll.status === "draft" && !operator) return null;
  if (viewer.role === "overlay" && !onAir) return null;
  const visible = livePollResultsVisible(
    { status: poll.status, showResults: poll.show_results === 1 },
    { role: viewer.role, voted: myAnswer !== null, onAir },
  );
  return {
    id: poll.id,
    field: poll.field,
    status: poll.status,
    showResults: poll.show_results === 1,
    results: visible ? formFieldStatFromTallies(poll.field, poll.tallies, poll.respondents) : null,
    myAnswer: poll.status === "open" ? myAnswer : null,
    createdAt: poll.created_at,
    change: operator ? { operatorName: poll.changed_by_name, at: poll.changed_at } : null,
  };
}

/** Every outgoing message passes the shared contract, so a room never sends what a client cannot parse. */
export function serializeLiveRoomMessage(message: LiveRoomServerMessage): string {
  return JSON.stringify(liveRoomServerMessageSchema.parse(message));
}

/** A socket message as the room protocol reads it, or null for anything it does not accept. */
export function parseLiveRoomMessage(raw: string | ArrayBuffer): LiveRoomClientMessage | null {
  if (typeof raw !== "string") return null;
  try {
    const parsed = liveRoomClientMessageSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
