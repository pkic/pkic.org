import type { LivePollPresentation } from "../../../../assets/shared/schemas/live-session-poll";
import type { LiveQuestionStatus } from "../../../../assets/shared/live-session-policy";
import type { LiveCredit, LiveRoomSession, LiveStage } from "../../../../assets/shared/schemas/live-session-room";
import type { LivePollStore } from "./room-poll-store";
import type { LiveRoomStore } from "./room-store";
import { parseLiveAuthorStamp } from "./room-authors";

export type LiveRefusal = { code: string; message: string };
type Change = { operatorName: string; at: string };

/**
 * A composition whose ticker and schedule the room has already resolved from
 * the approved agenda, and whose check-in code it resolved and signed, or
 * found missing.
 */
export type ResolvedComposition = {
  questionId: string | null;
  creditKey: string | null;
  pollId: string | null;
  pollPresentation: LivePollPresentation;
  lowerThirdMotion: LiveStage["lowerThirdMotion"];
  ticker: LiveStage["ticker"];
  panelists: LiveStage["panelists"];
  schedule: LiveStage["schedule"];
  checkIn: LiveStage["checkIn"] | LiveRefusal;
  timerGraphics: LiveStage["timerGraphics"];
};

export const LIVE_CREDIT_NOT_FOUND: LiveRefusal = {
  code: "LIVE_CREDIT_NOT_FOUND",
  message: "That person is no longer in this session's lower thirds.",
};

/** A lower third the room can show: a credit of the approved session, or a person operators added for it. */
export function findLiveRoomCredit(store: LiveRoomStore, session: LiveRoomSession, key: string): LiveCredit | null {
  return (
    session.credits.find((entry) => entry.key === key) ??
    store.addedCredits().find((entry) => entry.key === key) ??
    null
  );
}

/** Questions an output may show: approved, and answered ones an operator returns to. */
export const ON_AIR_QUESTION_STATUSES: readonly LiveQuestionStatus[] = ["approved", "answered"];

/** The question as an output shows it; an anonymous author stays anonymous to the audience. */
export function onAirQuestion(
  store: LiveRoomStore,
  questionId: string,
): NonNullable<LiveStage["question"]> | LiveRefusal {
  const row = store.question(questionId);
  if (!row || !ON_AIR_QUESTION_STATUSES.includes(row.status))
    return { code: "LIVE_QUESTION_NOT_FOUND", message: "Approve a question before putting it on air." };
  const anonymous = row.anonymous === 1;
  return {
    id: row.id,
    text: row.rewrite_text ?? row.body,
    authorName: anonymous ? null : row.author_name,
    authorPhotoUrl: anonymous ? null : row.author_photo_url,
    authorAffiliation: anonymous ? null : parseLiveAuthorStamp(row.author_json).affiliation,
  };
}

/**
 * Validates one complete composition against the room before any write, so
 * Program and every auxiliary output take a whole shot or nothing at all.
 */
export function composeLiveStage(
  store: LiveRoomStore,
  polls: LivePollStore,
  session: LiveRoomSession,
  input: ResolvedComposition,
  change: Change,
): LiveStage | LiveRefusal {
  let question: LiveStage["question"] = null;
  if (input.questionId) {
    const resolved = onAirQuestion(store, input.questionId);
    if ("code" in resolved) return resolved;
    question = resolved;
  }
  if (input.checkIn && "code" in input.checkIn) return input.checkIn;
  const credit = input.creditKey ? findLiveRoomCredit(store, session, input.creditKey) : null;
  if (input.creditKey && !credit) return LIVE_CREDIT_NOT_FOUND;
  const poll = input.pollId ? polls.poll(input.pollId) : null;
  if (input.pollId && (!poll || poll.status === "draft"))
    return { code: "LIVE_POLL_NOT_OPEN", message: "Open the poll before showing it on air." };
  const written = poll ? poll.field.fieldType === "text" || poll.field.fieldType === "textarea" : false;
  if (poll && written && input.pollPresentation.chart !== "wordcloud")
    return { code: "LIVE_POLL_PRESENTATION", message: "Show written answers as a word cloud." };
  if (poll && !written && input.pollPresentation.chart === "wordcloud")
    return { code: "LIVE_POLL_PRESENTATION", message: "Use a bar, donut or pie for choice and rating answers." };
  if (input.timerGraphics.some((graphic) => !store.timers(session).some((timer) => timer.id === graphic.timerId)))
    return { code: "LIVE_TIMER_NOT_FOUND", message: "That timer is no longer in this room. Choose another one." };
  return {
    ticker: input.ticker,
    panelists: input.panelists,
    schedule: input.schedule,
    checkIn: input.checkIn,
    question,
    questionChange: change,
    lowerThird: credit ?? null,
    lowerThirdChange: change,
    lowerThirdMotion: input.lowerThirdMotion,
    poll: input.pollId ? { id: input.pollId, presentation: input.pollPresentation } : null,
    pollChange: change,
    timerGraphics: input.timerGraphics,
  };
}
