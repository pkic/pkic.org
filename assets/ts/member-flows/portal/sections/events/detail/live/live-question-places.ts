import type { LiveQuestion } from "../../../../../../../shared/schemas/live-session-room";

/**
 * Where a question is in the studio's Questions panel. Open ones wait for
 * the stage. The rest left the open ones and can each come back: discussed
 * on stage, ignored (not taken to the stage, with nothing wrong with it, so
 * attendees still see it), or hidden by a moderator with a reason.
 */
export const LIVE_QUESTION_PLACES = ["open", "discussed", "ignored", "hidden"] as const;
export type LiveQuestionPlace = (typeof LIVE_QUESTION_PLACES)[number];
export type LiveClosedQuestionPlace = Exclude<LiveQuestionPlace, "open">;

/** The place a question is in; null for one its author withdrew after it left the open ones, which is gone for good. */
export function liveQuestionPlace(question: LiveQuestion): LiveQuestionPlace | null {
  if (question.status === "hidden") return question.withdrawn ? null : "hidden";
  if (question.status === "answered") return question.withdrawn ? null : "discussed";
  return question.done ? "ignored" : "open";
}

/** The questions in one place, in the room's order. */
export function liveQuestionsIn(questions: readonly LiveQuestion[], place: LiveQuestionPlace): LiveQuestion[] {
  return questions.filter((question) => liveQuestionPlace(question) === place);
}

/** Each closed place as its tab names it, what the tab says when empty, and how a question there comes back. */
export const LIVE_CLOSED_QUESTION_PLACES = [
  {
    id: "discussed",
    label: "Discussed",
    empty: "No discussed questions.",
    back: { label: "Reopen", hint: "Put it back with the open questions." },
  },
  {
    id: "ignored",
    label: "Ignored",
    empty: "No ignored questions.",
    back: { label: "Back to Open", hint: "Put it back with the open questions." },
  },
  {
    id: "hidden",
    label: "Hidden",
    empty: "No hidden questions.",
    back: { label: "Show question", hint: "Show it to everyone again, with the open questions." },
  },
] as const satisfies ReadonlyArray<{
  id: LiveClosedQuestionPlace;
  label: string;
  empty: string;
  back: { label: string; hint: string };
}>;
