import { LIVE_AUX_OUTPUTS, type LiveAuxOutput } from "../../shared/live-room-outputs";
import type { LiveOverlayView } from "../../shared/schemas/live-session-room";
import type { LiveRoomState } from "./live-room-state";
import { liveStageDisplayQuestions } from "../../shared/live-stage-display";
import { liveScreenComposition, liveScreenSyncs } from "../../shared/live-screen-sync";

export function isLiveAuxOutput(view: string): view is LiveAuxOutput {
  return (LIVE_AUX_OUTPUTS as readonly string[]).includes(view);
}

/**
 * The room as one auxiliary output shows it: its own composition, with
 * Program's graphics while it syncs (see live-screen-sync). The stage
 * display also shows the speaker the question lined up next in Preview
 * while it syncs.
 */
export function liveOutputProjection(state: LiveRoomState, output: LiveAuxOutput): LiveRoomState {
  const stage = liveScreenComposition(output, {
    own: state.outputs[output],
    program: state.stage,
    sync: state.screenSync,
    timers: state.timers,
  });
  if (output !== "stage-display") return { ...state, stage, stageDisplayNext: null };
  const questions = liveStageDisplayQuestions(
    stage,
    liveScreenSyncs(state.screenSync, output) ? state.stageDisplayNext : null,
  );
  return { ...state, stage, stageDisplayNext: questions.next };
}

/** The overlay view an auxiliary output renders through: its own layout for the stage display, else Program's. */
export function liveOutputView(view: LiveOverlayView): LiveOverlayView {
  return isLiveAuxOutput(view) && view !== "stage-display" ? "program" : view;
}
