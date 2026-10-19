/**
 * Product policy for a session's live room: the reaction set, the attendee
 * window, the moderation transitions and the per-person limits. The Durable
 * Object, the Worker and both browser surfaces read these values from here.
 */

/** The fixed quick reactions, in display order. */
export const LIVE_REACTIONS = [
  { id: "applause", emoji: "👏", label: "Applause" },
  { id: "love", emoji: "❤️", label: "Love" },
  { id: "laugh", emoji: "😂", label: "Laugh" },
  { id: "mind_blown", emoji: "🤯", label: "Mind blown" },
  { id: "thumbs_up", emoji: "👍", label: "Thumbs up" },
] as const;

export type LiveReactionId = (typeof LIVE_REACTIONS)[number]["id"];
export const LIVE_REACTION_IDS = LIVE_REACTIONS.map((reaction) => reaction.id) as [LiveReactionId, ...LiveReactionId[]];

export const LIVE_ROOM_POLICY = {
  /** Attendees may ask, vote and react from this long before the scheduled start… */
  opensBeforeStartMinutes: 15,
  /** …until this long after the scheduled end, so the Q&A can run over. */
  closesAfterEndMinutes: 30,
  chatMaxLength: 500,
  chatPerPerson: { limit: 10, windowSeconds: 60 },
  questionMinLength: 3,
  questionMaxLength: 280,
  /** The room refuses new questions once it holds this many. */
  maxQuestionsPerRoom: 300,
  /** Question creation and unreviewed author edits share this durable write allowance. */
  questionsPerPerson: { limit: 3, windowSeconds: 60 },
  reactionsPerPerson: { limit: 10, windowSeconds: 10 },
  /** Reactions are counted, then broadcast together at most this often. */
  reactionBurstMilliseconds: 1000,
  /** A changed room writes its durable copy at most this long after the change. */
  durableCopyDelaySeconds: 30,
  /** An overlay link stays usable for one conference day. */
  overlayAccessHours: 24,
  /** Each prepared lineup of the control desk holds at most this many items. */
  queueMaxLength: 30,
  /**
   * The room's own storage is erased this long after the scheduled end, once
   * its durable copy has reached D1. Ballots and author names never outlive it.
   */
  storagePurgeAfterEndDays: 7,
} as const;

/** Authors may refine a pending question until moderation starts; reviewed wording stays stable for votes and replies. */
export function canEditOwnLiveQuestion(input: {
  mine: boolean;
  status: LiveQuestionStatus;
  reviewed: boolean;
  withdrawn: boolean;
}): boolean {
  return input.mine && input.status === "pending" && !input.reviewed && !input.withdrawn;
}

/** Live answer threads are bounded separately from the room-wide question queue. */
export const LIVE_QUESTION_ANSWER_POLICY = {
  minLength: 3,
  maxLength: 2000,
  maxAnswersPerQuestion: 25,
  maxAnswersPerRoom: 1000,
  perPerson: { limit: 5, windowSeconds: 60 },
} as const;

/** Published-question reply policy; the owning command also enforces current admission and its live window. */
export function canAnswerLiveQuestion(role: LiveRoomRole, status: LiveQuestionStatus): boolean {
  return role !== "overlay" && PUBLIC_LIVE_QUESTION_STATUSES.includes(status);
}

/** Speaker duties confer no acceptance authority over another person's question. */
export function canAcceptLiveQuestionAnswer({
  role,
  organizer,
  mine,
}: {
  role: LiveRoomRole;
  organizer: boolean;
  mine: boolean;
}): boolean {
  return role !== "overlay" && (mine || organizer || role === "operator");
}

/**
 * What an operator may prepare for a session: one form question whose
 * answers can be counted live — a single or multiple choice, or a rating.
 */
export const LIVE_POLL_POLICY = {
  /** The form field types a poll may ask; a number only as a rating widget. */
  fieldTypes: ["select", "multi_select", "number", "text", "textarea"],
  ratingWidgets: ["rating_stars", "nps"],
  minChoices: 2,
  maxChoices: 10,
  /** A rating's scale, so every score fits one row on a phone and on air. */
  maxRatingScores: 11,
  /** The room refuses new polls once it holds this many. */
  maxPollsPerRoom: 30,
  /** Tallies are recounted on every ballot, then broadcast together at most this often. */
  tallyBroadcastMilliseconds: 1000,
} as const;

/** A poll is prepared as a draft, opened for voting and may be reopened with its answers retained. */
export const LIVE_POLL_STATUSES = ["draft", "open", "closed"] as const;
export type LivePollStatus = (typeof LIVE_POLL_STATUSES)[number];

const POLL_TRANSITIONS: Record<LivePollStatus, readonly LivePollStatus[]> = {
  draft: ["open"],
  open: ["closed"],
  closed: ["open"],
};

export function livePollTransitionAllowed(from: LivePollStatus, to: LivePollStatus): boolean {
  return POLL_TRANSITIONS[from].includes(to);
}

/**
 * Whether a viewer sees a poll's tallies. Operators always do. Everyone else
 * only when the operator chose to show results: once the poll is closed, or
 * while it is open after they voted, so the running count does not steer
 * their own choice. A broadcast overlay shows the tallies of the poll on air.
 */
export function livePollResultsVisible(
  poll: { status: LivePollStatus; showResults: boolean },
  viewer: { role: LiveRoomRole; voted: boolean; onAir: boolean },
): boolean {
  if (viewer.role === "operator") return true;
  if (viewer.role === "overlay") return viewer.onAir;
  if (!poll.showResults || poll.status === "draft") return false;
  return poll.status === "closed" || viewer.voted;
}

/** The parts of the broadcast an operator lines up and puts on air one after another. */
export const LIVE_STAGE_VIEWS = ["question", "lower-third", "poll"] as const;
export type LiveStageView = (typeof LIVE_STAGE_VIEWS)[number];

/** The moderation lifecycle. New questions wait for a moderator before others see them. */
export const LIVE_QUESTION_STATUSES = ["pending", "approved", "answered", "hidden"] as const;
export type LiveQuestionStatus = (typeof LIVE_QUESTION_STATUSES)[number];

/** Statuses every room participant can see; the author also sees their own question in any status. */
export const PUBLIC_LIVE_QUESTION_STATUSES: readonly LiveQuestionStatus[] = ["approved", "answered"];

const MODERATOR_TRANSITIONS: Record<LiveQuestionStatus, readonly LiveQuestionStatus[]> = {
  pending: ["approved", "hidden"],
  approved: ["answered", "hidden"],
  answered: ["approved", "hidden"],
  hidden: ["approved"],
};

/** A credited speaker answers questions on stage but does not moderate the queue. */
const SPEAKER_TRANSITIONS: Record<LiveQuestionStatus, readonly LiveQuestionStatus[]> = {
  pending: [],
  approved: ["answered"],
  answered: ["approved"],
  hidden: [],
};

export type LiveRoomRole = "attendee" | "speaker" | "operator" | "overlay";

export function liveQuestionTransitionAllowed(
  role: LiveRoomRole,
  from: LiveQuestionStatus,
  to: LiveQuestionStatus,
): boolean {
  const transitions = role === "operator" ? MODERATOR_TRANSITIONS : role === "speaker" ? SPEAKER_TRANSITIONS : null;
  return transitions?.[from].includes(to) ?? false;
}

/** The transitions a role may offer for a question, for rendering its actions. */
export function liveQuestionTransitions(role: LiveRoomRole, from: LiveQuestionStatus): readonly LiveQuestionStatus[] {
  return role === "operator" ? MODERATOR_TRANSITIONS[from] : role === "speaker" ? SPEAKER_TRANSITIONS[from] : [];
}

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/** When a room erases its own storage, as epoch milliseconds. */
export function liveRoomPurgeAt(endAt: string): number {
  return Date.parse(endAt) + LIVE_ROOM_POLICY.storagePurgeAfterEndDays * DAY;
}

/** The attendee window around a scheduled session, as epoch milliseconds. */
export function liveRoomWindow(startAt: string, endAt: string) {
  return {
    opensAt: Date.parse(startAt) - LIVE_ROOM_POLICY.opensBeforeStartMinutes * MINUTE,
    closesAt: Date.parse(endAt) + LIVE_ROOM_POLICY.closesAfterEndMinutes * MINUTE,
  };
}

/** Whether attendees may ask, vote and react at `now`. */
export function liveRoomOpen(now: number, startAt: string, endAt: string): boolean {
  const window = liveRoomWindow(startAt, endAt);
  return now >= window.opensAt && now <= window.closesAt;
}

export type LiveQuestionOrder = "top" | "new";

/**
 * The one ordering of a room's questions. The room sends its list in this
 * order and a client places each pushed change with the same rule, so the
 * two never disagree. Ties fall back to the newer question, then the id.
 */
export function compareLiveQuestions(
  order: LiveQuestionOrder,
  left: { votes: number; askedAt: string; id: string },
  right: { votes: number; askedAt: string; id: string },
): number {
  if (order === "top" && left.votes !== right.votes) return right.votes - left.votes;
  if (left.askedAt !== right.askedAt) return left.askedAt < right.askedAt ? 1 : -1;
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

/** A sliding per-person allowance; returns whether the action is allowed and records it when it is. */
export function takeLiveAllowance(
  history: number[],
  now: number,
  allowance: { limit: number; windowSeconds: number },
): boolean {
  const since = now - allowance.windowSeconds * 1000;
  while (history.length && history[0] <= since) history.shift();
  if (history.length >= allowance.limit) return false;
  history.push(now);
  return true;
}
