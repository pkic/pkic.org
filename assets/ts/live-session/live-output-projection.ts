import { liveOutputFixedScene, liveRoomOutputs, type LiveAuxOutput } from "../../shared/live-room-outputs";
import { LIVE_SPEAKER_OUTPUT_KEY } from "../../shared/schemas/live-room-output-setup";
import { liveOutputComposition } from "../../shared/schemas/live-session-stage";
import type { LiveOverlayView } from "../../shared/schemas/live-session-room";
import type { LiveRoomState } from "./live-room-state";
import { liveStageDisplayQuestions } from "../../shared/live-stage-display";
import { liveScreenComposition, liveScreenSyncs } from "../../shared/live-screen-sync";

/** Every overlay view but Program draws one of the room's other outputs. */
export function isLiveAuxOutput(view: string): view is LiveAuxOutput {
  return view !== "program";
}

/**
 * The room as one auxiliary output shows it: its own composition, with
 * Program's graphics while it syncs (see live-screen-sync). The stage
 * display also shows the speaker the question lined up next in Preview
 * while it syncs.
 */
export function liveOutputProjection(state: LiveRoomState, output: LiveAuxOutput): LiveRoomState {
  const outputs = liveRoomOutputs(state.session);
  const stage = liveScreenComposition(output, {
    own: liveOutputComposition(state.outputs, output),
    program: state.stage,
    sync: state.screenSync,
    timers: state.timers,
    outputs,
  });
  if (output !== LIVE_SPEAKER_OUTPUT_KEY) return { ...state, stage, stageDisplayNext: null };
  const questions = liveStageDisplayQuestions(
    stage,
    liveScreenSyncs(state.screenSync, outputs, output) ? state.stageDisplayNext : null,
  );
  return { ...state, stage, stageDisplayNext: questions.next };
}

/** The overlay view an auxiliary output renders through: its own layout for the speaker's screen, else Program's. */
export function liveOutputView(view: LiveOverlayView): LiveOverlayView {
  return isLiveAuxOutput(view) && view !== LIVE_SPEAKER_OUTPUT_KEY ? "program" : view;
}

/**
 * The scene an output draws when its link names none: for a room screen the
 * one its room fixed for it, else the one last taken to it, which its own
 * composition holds. A screen that follows Program still draws its own
 * scene, never Program's.
 */
export function liveOutputScene(state: LiveRoomState | null, view: LiveOverlayView): string | null {
  if (!state) return null;
  if (view === "program") return state.stage.scene;
  return liveOutputFixedScene(liveRoomOutputs(state.session), view) ?? liveOutputComposition(state.outputs, view).scene;
}
