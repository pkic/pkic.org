import { selectLiveTopQuestions } from "../../shared/live-on-screen-lists";
import {
  DEFAULT_LIVE_TOP_QUESTIONS_CONFIG,
  type LiveTopQuestion,
  type LiveTopQuestionsOnAir,
} from "../../shared/schemas/live-session-on-screen";
import type { LiveStage } from "../../shared/schemas/live-session-stage";
import { liveRoomCredits, type LiveRoomState } from "./live-room-state";

/** The room's open questions with the most votes, as an output lists them; an anonymous author stays anonymous. */
function roomTopQuestions(room: LiveRoomState, onPreview: LiveTopQuestionsOnAir | null): LiveTopQuestionsOnAir | null {
  const config = onPreview?.config ?? DEFAULT_LIVE_TOP_QUESTIONS_CONFIG;
  const questions = selectLiveTopQuestions(room.questions, config.count).map((question): LiveTopQuestion => ({
    id: question.id,
    text: question.text,
    authorName: question.anonymous ? null : question.authorName,
    votes: question.votes,
  }));
  return questions.length ? { config, questions } : null;
}

/** A list an output shows, only while it holds something. */
const withQuestions = (list: LiveStage["topQuestions"] | undefined) => (list?.questions.length ? list : null);
const withMessages = (list: LiveStage["chatFeed"] | undefined) => (list?.messages.length ? list : null);

/**
 * What one scene's thumbnail draws: Preview's composition, each graphic
 * Preview has empty filled from what the room really has, so a thumbnail
 * shows the scene as it would look rather than an empty frame. A graphic
 * takes Program's first; else the lower third takes the session's first
 * credit and top questions the room's open questions by votes. Nothing is
 * made up: a graphic the room has nothing for stays empty.
 */
export function liveSceneThumbnailState(preview: LiveRoomState, program: LiveRoomState | null): LiveRoomState {
  const own = preview.stage;
  const aired = program?.stage ?? null;
  // A poll or a timer is drawn from this room's own lists, so Program's counts only when this room has it.
  const pollKnown = aired?.poll && preview.polls.some((poll) => poll.id === aired.poll!.id) ? aired.poll : null;
  const timersKnown = (aired?.timerGraphics ?? []).filter((graphic) =>
    preview.timers.some((timer) => timer.id === graphic.timerId),
  );
  const stage: LiveStage = {
    ...own,
    question: own.question ?? aired?.question ?? null,
    lowerThird: own.lowerThird ?? aired?.lowerThird ?? liveRoomCredits(preview)[0] ?? null,
    poll: own.poll ?? pollKnown,
    panelists: own.panelists ?? aired?.panelists ?? null,
    schedule: own.schedule ?? aired?.schedule ?? null,
    checkIn: own.checkIn ?? aired?.checkIn ?? null,
    ticker: own.ticker ?? aired?.ticker ?? null,
    timerGraphics: own.timerGraphics.length ? own.timerGraphics : timersKnown,
    topQuestions:
      withQuestions(own.topQuestions) ??
      withQuestions(aired?.topQuestions) ??
      roomTopQuestions(preview, own.topQuestions) ??
      own.topQuestions,
    chatFeed: withMessages(own.chatFeed) ?? withMessages(aired?.chatFeed) ?? own.chatFeed,
  };
  // A thumbnail stays still: no reaction bursts float over it.
  return { ...preview, stage, burst: null };
}

/**
 * Whether two room states give the same thumbnails: only Preview's and
 * Program's compositions and the lists they fill from count, so chat,
 * presence and the queue leave the thumbnails alone.
 */
export function sameLiveSceneThumbnailSource(
  previous: { preview: LiveRoomState; program: LiveRoomState | null },
  next: { preview: LiveRoomState; program: LiveRoomState | null },
): boolean {
  const [left, right] = [previous.preview, next.preview];
  return (
    left.stage === right.stage &&
    left.questions === right.questions &&
    left.session === right.session &&
    left.addedCredits === right.addedCredits &&
    left.timers === right.timers &&
    left.polls === right.polls &&
    left.overlayLayouts === right.overlayLayouts &&
    previous.program?.stage === next.program?.stage
  );
}
