import { LIVE_AUX_OUTPUTS, type LiveAuxOutput } from "../../shared/live-room-outputs";
import type { LiveOverlayView } from "../../shared/schemas/live-session-room";
import type { LiveRoomState } from "./live-room-state";
import { liveStageDisplayQuestions } from "../../shared/live-stage-display";

export function isLiveAuxOutput(view: string): view is LiveAuxOutput {
  return (LIVE_AUX_OUTPUTS as readonly string[]).includes(view);
}

/**
 * The room as one auxiliary output shows it: that output's own composition,
 * timer graphic included. The stage display also shows the speaker the
 * question being answered on Program and the one lined up next in Preview,
 * and the poll on Program, unless an operator put others on it.
 */
export function liveOutputProjection(state: LiveRoomState, output: LiveAuxOutput): LiveRoomState {
  const own = state.outputs[output];
  if (output !== "stage-display") return { ...state, stage: own, stageDisplayNext: null };
  const questions = liveStageDisplayQuestions(own, state.stage, state.stageDisplayNext);
  return {
    ...state,
    stage: { ...own, question: questions.current, poll: own.poll ?? state.stage.poll },
    stageDisplayNext: questions.next,
  };
}

/** The overlay view an auxiliary output renders through: its own layout for the stage display, else Program's. */
export function liveOutputView(view: LiveOverlayView): LiveOverlayView {
  return isLiveAuxOutput(view) && view !== "stage-display" ? "program" : view;
}
