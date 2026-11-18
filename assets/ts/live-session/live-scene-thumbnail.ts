import { liveOverlayDrawn } from "../../shared/live-overlay-cover";
import { resolveLiveSceneElements } from "../../shared/live-scene-elements";
import { LIVE_PROGRAM_LAYER_ORDER } from "../../shared/live-overlay-stacking";
import {
  liveOverlayElementAlwaysOn,
  type LiveOverlayElement,
  type LiveOverlayElementPlacement,
} from "../../shared/schemas/live-overlay-layout";
import type { LiveStage } from "../../shared/schemas/live-session-stage";
import type { LiveRoomState } from "./live-room-state";

/**
 * What one scene's thumbnail draws: the graphics Preview holds now, laid out
 * in that scene. The thumbnail stays still: no reaction bursts float over it.
 */
export function liveSceneThumbnailState(preview: LiveRoomState): LiveRoomState {
  return preview.burst ? { ...preview, burst: null } : preview;
}

/** Whether two Preview states give the same thumbnails: chat, presence and the queue leave them alone. */
export function sameLiveSceneThumbnailSource(previous: LiveRoomState, next: LiveRoomState): boolean {
  return (
    previous.stage === next.stage &&
    previous.session === next.session &&
    previous.timers === next.timers &&
    previous.polls === next.polls &&
    previous.overlayLayouts === next.overlayLayouts &&
    previous.speakerMessage === next.speakerMessage
  );
}

/** The graphics with a switch, which an output can have on; the background and the QR code come with the scene itself. */
const OPERATOR_GRAPHICS = LIVE_PROGRAM_LAYER_ORDER.filter((layer) => !liveOverlayElementAlwaysOn(layer));

/** The scene's own boxes, outside the stage display's: an empty Preview outlines them so each scene stays recognizable. */
const OUTLINED: readonly LiveOverlayElement[] = [...OPERATOR_GRAPHICS, "qrCode"];

/** Whether Preview holds no graphic, so its thumbnails draw only the scene. */
export function liveSceneThumbnailEmpty(stage: LiveStage): boolean {
  return !OPERATOR_GRAPHICS.some((graphic) => liveOverlayDrawn(stage, graphic));
}

/** The boxes one scene shows its graphics in, for the faint outline on an empty Preview's thumbnail. */
export function liveSceneOutline(
  state: Pick<LiveRoomState, "overlayLayouts">,
  scene: string,
): LiveOverlayElementPlacement[] {
  const elements = resolveLiveSceneElements(state, scene);
  return OUTLINED.map((element) => elements[element]).filter((placement) => placement.visible);
}
