import { liveOverlayCoveredBy, liveOverlayWaitsForTurn } from "../../../../../../../shared/live-overlay-cover";
import { liveOverlaySpotOf, liveOverlaySpotTurns } from "../../../../../../../shared/live-overlay-spots";
import { liveOverlayLayoutChoices } from "../../../../../../../shared/live-overlay-layout-presets";
import { resolveLiveSceneElements } from "../../../../../../../shared/live-scene-elements";
import type { LiveProgramLayer } from "../../../../../../../shared/live-overlay-stacking";
import { LIVE_OVERLAY_ELEMENT_LABELS } from "../../../../../../../shared/schemas/live-overlay-layout";
import type { LiveStage } from "../../../../../../../shared/schemas/live-session-room";
import type { LiveRoomState } from "../../../../../../live-session/live-room-state";

/**
 * Why a composition that holds a graphic does not show it: a board drawn
 * over it, such as Up next under a full-screen question, its spot's turn
 * held by another board, or a scene that leaves it out. Named as the studio
 * names them.
 */
export type LiveLayerUnseen =
  | { reason: "covered"; by: string }
  | { reason: "waiting"; turns: number }
  | { reason: "scene"; scene: string };

/** A scene's name as the operators picked it; an unknown one is drawn as the event's default. */
export function liveSceneName(state: Pick<LiveRoomState, "overlayLayouts">, slug: string | null): string {
  const choices = liveOverlayLayoutChoices(state.overlayLayouts);
  return (choices.find((choice) => choice.slug === slug) ?? choices[0]!).name;
}

/** Why this composition, which holds the graphic, does not show it, as its scene draws it; null when it shows. */
export function liveLayerUnseen(
  state: Pick<LiveRoomState, "overlayLayouts">,
  stage: LiveStage,
  layer: LiveProgramLayer,
  now = Date.now(),
): LiveLayerUnseen | null {
  const elements = resolveLiveSceneElements(state, stage.scene);
  if (!elements[layer].visible) return { reason: "scene", scene: liveSceneName(state, stage.scene) };
  const board = liveOverlayCoveredBy(stage, elements, layer);
  if (board) return { reason: "covered", by: LIVE_OVERLAY_ELEMENT_LABELS[board] };
  if (!liveOverlayWaitsForTurn(stage, elements, layer, now)) return null;
  const spot = liveOverlaySpotOf(elements, layer);
  return { reason: "waiting", turns: (spot && liveOverlaySpotTurns(elements, spot)) ?? 0 };
}

/** The short words for it after the output's own state: "covered by Question", "next in turn", "not in this scene". */
export const liveLayerUnseenWords = (unseen: LiveLayerUnseen) =>
  unseen.reason === "covered"
    ? `covered by ${unseen.by}`
    : unseen.reason === "waiting"
      ? "next in turn"
      : "not in this scene";

/**
 * The one line a graphic's row says when an output holds it unseen,
 * Program first: "On air · covered by Question". Null while every output
 * that holds it shows it.
 */
export function liveLayerUnseenLine(where: {
  programUnseen: LiveLayerUnseen | null;
  previewUnseen: LiveLayerUnseen | null;
}): string | null {
  if (where.programUnseen) return `On air · ${liveLayerUnseenWords(where.programUnseen)}`;
  if (where.previewUnseen) return `In Preview · ${liveLayerUnseenWords(where.previewUnseen)}`;
  return null;
}
