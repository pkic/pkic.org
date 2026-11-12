/**
 * The audience lists an output can show: the open questions with the most
 * votes, and the latest attendee chat. The room fills both from its own
 * moderation before anything reaches an output; operators choose only how
 * many lines show.
 */
import { compareLiveQuestions, type LiveQuestionStatus } from "./live-session-policy";

export const LIVE_ON_SCREEN_LIST_POLICY = {
  /** Top questions: as many as stay readable on a projector and beside a speaker on the stream. */
  questions: { min: 1, max: 5, default: 3 },
  /** Latest chat messages, newest last. */
  chat: { min: 1, max: 6, default: 4 },
  /**
   * How long, in seconds, a new chat message waits before an output may show
   * it, so moderators can hide it first. The livestream itself often runs up
   * to half a minute behind, so a short wait is rarely seen by viewers.
   */
  chatDelaySeconds: { choices: [0, 10, 30, 60], default: 10 },
} as const;

/** The parts of a question the selection reads; the room's rows and the operators' list both carry them. */
export interface LiveTopQuestionCandidate {
  id: string;
  status: LiveQuestionStatus;
  votes: number;
  askedAt: string;
  withdrawn: boolean;
}

/**
 * The open questions with the most votes, most first; ties go to the newer
 * question, as the room orders its list. Open means approved: pending and
 * hidden questions are not public yet or any more, answered ones are done,
 * and a withdrawn question is its author's to take back.
 */
export function selectLiveTopQuestions<Question extends LiveTopQuestionCandidate>(
  questions: readonly Question[],
  count: number,
): Question[] {
  return questions
    .filter((question) => question.status === "approved" && !question.withdrawn)
    .sort((left, right) => compareLiveQuestions("top", left, right))
    .slice(0, Math.max(0, count));
}
