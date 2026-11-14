import { LIVE_AUX_OUTPUTS, type LiveAuxOutput } from "../../shared/live-room-outputs";
import type { LiveOverlayView } from "../../shared/schemas/live-session-room";
import type { LiveRoomState } from "./live-room-state";
import { liveStageDisplayQuestions } from "../../shared/live-stage-display";
import { liveScreenProgram, liveSyncedComposition } from "../../shared/live-screen-sync";

export function isLiveAuxOutput(view: string): view is LiveAuxOutput {
  return (LIVE_AUX_OUTPUTS as readonly string[]).includes(view);
}

/**
 * The room as one auxiliary output shows it: that output's own composition,
 * timer graphic included. While the projector syncs with Program it also
 * shows what is live wherever it has nothing of its own. While the stage
 * display syncs, it shows the speaker the question being answered on
 * Program and the one lined up next in Preview, and the poll on Program,
 * unless an operator put others on it.
 */
export function liveOutputProjection(state: LiveRoomState, output: LiveAuxOutput): LiveRoomState {
  const own = state.outputs[output];
  if (output === "projector")
    return {
      ...state,
      stage: state.screenSync.projector ? liveSyncedComposition(own, state.stage) : own,
      stageDisplayNext: null,
    };
  if (output !== "stage-display") return { ...state, stage: own, stageDisplayNext: null };
  const program = liveScreenProgram(state.stage, state.screenSync, output);
  const questions = liveStageDisplayQuestions(
    own,
    program,
    state.screenSync["stage-display"] ? state.stageDisplayNext : null,
  );
  return {
    ...state,
    stage: { ...own, question: questions.current, poll: own.poll ?? program.poll },
    stageDisplayNext: questions.next,
  };
}

/** The overlay view an auxiliary output renders through: its own layout for the stage display, else Program's. */
export function liveOutputView(view: LiveOverlayView): LiveOverlayView {
  return isLiveAuxOutput(view) && view !== "stage-display" ? "program" : view;
}
