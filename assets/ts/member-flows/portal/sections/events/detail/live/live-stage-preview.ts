import { updateLiveTimerGraphics } from "../../../../../../../shared/live-timer-policy";
import type {
  LiveCheckInOnAir,
  LiveRoomClientMessage,
  LiveStage,
} from "../../../../../../../shared/schemas/live-session-room";
import { DEFAULT_LIVE_POLL_PRESENTATION } from "../../../../../../../shared/schemas/live-session-poll";
import { liveCompositionInput } from "../../../../../../../shared/live-room-preview";
import { liveRoomCredits, type LiveRoomState } from "../../../../../../live-session/live-room-state";

export { liveCompositionInput } from "../../../../../../../shared/live-room-preview";

/** A composition with one command applied, resolved only from approved room objects, before the room sends it back. */
export function previewLiveStage(
  state: LiveRoomState,
  stage: LiveStage,
  message: LiveRoomClientMessage,
  /** The check-in code the operator picked, as the listing signed it; the room signs it again. */
  checkIn?: LiveCheckInOnAir | null,
): LiveStage {
  const next = { ...stage };
  if (message.type === "stage.lowerThird" || message.type === "stage.set") {
    const key = message.creditKey;
    next.lowerThird = key ? (liveRoomCredits(state).find((credit) => credit.key === key) ?? null) : null;
    next.lowerThirdChange = null;
    const motion = message.type === "stage.set" ? message.lowerThirdMotion : message.motion;
    if (motion) next.lowerThirdMotion = motion;
  }
  if (message.type === "stage.question" || message.type === "stage.set") {
    const question = message.questionId ? state.questions.find((entry) => entry.id === message.questionId) : null;
    next.question = question
      ? {
          id: question.id,
          text: question.text,
          authorName: question.anonymous ? null : question.authorName,
          authorPhotoUrl: question.anonymous ? null : question.authorPhotoUrl,
          authorAffiliation: question.anonymous ? null : (question.authorAffiliation ?? null),
        }
      : null;
    next.questionChange = null;
  }
  if (message.type === "stage.poll" || message.type === "stage.set") {
    const id = message.pollId;
    const presentation =
      message.type === "stage.set"
        ? message.pollPresentation
        : (stage.poll?.presentation ?? DEFAULT_LIVE_POLL_PRESENTATION);
    next.poll = id && state.polls.some((poll) => poll.id === id) ? { id, presentation } : null;
    next.pollChange = null;
  }
  if (message.type === "stage.schedule" || message.type === "stage.set")
    next.schedule = message.schedule
      ? { config: message.schedule, available: false, timeZone: null, resolvedAt: state.session.startAt, rooms: [] }
      : null;
  if (message.type === "stage.panelists" || message.type === "stage.set") next.panelists = message.panelists;
  if (message.type === "stage.set")
    next.checkIn =
      message.checkIn === null
        ? null
        : checkIn && JSON.stringify(checkIn.selection) === JSON.stringify(message.checkIn)
          ? { ...checkIn, theme: message.checkInTheme, text: message.checkInText }
          : stage.checkIn && { ...stage.checkIn, theme: message.checkInTheme, text: message.checkInText };
  if (message.type === "stage.ticker" || message.type === "stage.set")
    next.ticker = message.ticker ? { ...message.ticker, segments: [] } : null;
  if (message.type === "stage.set") next.timerGraphics = message.timerGraphics;
  if (message.type === "stage.timer")
    next.timerGraphics = updateLiveTimerGraphics(stage.timerGraphics, message.timer, message.visible);
  return next;
}

/** One complete graphics composition for Program, crossing the room's atomic command boundary. */
export function takeLiveStage(stage: LiveStage): Extract<LiveRoomClientMessage, { type: "stage.set" }> {
  return { type: "stage.set", ...liveCompositionInput(stage) };
}

/**
 * How many graphics a Take would change on Program: each layer whose source
 * differs between the shared Preview and Program.
 */
export function livePreviewDifferences(preview: LiveStage, program: LiveStage): number {
  const left = liveCompositionInput(preview),
    right = liveCompositionInput(program);
  const layers: Array<keyof typeof left> = [
    "creditKey",
    "questionId",
    "ticker",
    "panelists",
    "schedule",
    "checkIn",
    "timerGraphics",
  ];
  const changed = layers.filter((layer) => JSON.stringify(left[layer]) !== JSON.stringify(right[layer])).length;
  const poll =
    left.pollId !== right.pollId ||
    (left.pollId !== null && left.pollPresentation.chart !== right.pollPresentation.chart);
  const checkInPresentationChanged =
    left.checkIn !== null &&
    JSON.stringify(left.checkIn) === JSON.stringify(right.checkIn) &&
    (left.checkInTheme !== right.checkInTheme ||
      JSON.stringify(left.checkInText) !== JSON.stringify(right.checkInText));
  return changed + (poll ? 1 : 0) + (checkInPresentationChanged ? 1 : 0);
}
