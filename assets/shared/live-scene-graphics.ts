import { isLiveOverlayPreset, resolveLiveOverlayLayout } from "./live-overlay-layout-presets";
import {
  LIVE_OVERLAY_DEFAULT_LAYOUT,
  type LiveOverlayElement,
  type LiveOverlayLayoutElements,
  type LiveOverlayLayoutGeometry,
  type LiveOverlayPreset,
} from "./schemas/live-overlay-layout";
import type { LivePanelists } from "./schemas/live-session-room";

/**
 * A scene is a preset combination of graphics, positions and backgrounds.
 * Loading one on Preview also puts its graphics on, each with the room's own
 * content: the session's speaker, its timer, the current top questions.
 * These are the graphics a scene can bring on that way.
 */
export const LIVE_SCENE_GRAPHICS = [
  "lowerThird",
  "timer",
  "ticker",
  "topQuestions",
  "panelists",
  "checkIn",
  "schedule",
] as const satisfies readonly LiveOverlayElement[];
export type LiveSceneGraphic = (typeof LIVE_SCENE_GRAPHICS)[number];

/** What each built-in scene puts on when it is loaded. */
export const LIVE_SCENE_BRINGS_ON: Record<LiveOverlayPreset, readonly LiveSceneGraphic[]> = {
  talk: ["lowerThird", "timer", "ticker"],
  questions: ["topQuestions", "ticker", "timer"],
  panel: ["panelists", "ticker", "timer"],
  break: ["timer", "ticker", "schedule"],
  "check-in": ["checkIn", "ticker"],
  "full-board": [],
};

/**
 * What an event's own scene puts on when it did not start from a built-in
 * one: the graphics that never cover the camera. A board covers it, so the
 * operator puts one on deliberately.
 */
const OWN_SCENE_BRINGS_ON: readonly LiveSceneGraphic[] = ["lowerThird", "timer", "ticker"];

/** The panel row's layout when the operator has not chosen one. */
export const DEFAULT_LIVE_PANELISTS: LivePanelists = { layout: "panel" };

/** A line-up of every speaker only means something when there is more than one. */
export function liveSessionHasPanel(creditCount: number): boolean {
  return creditCount > 1;
}

/** A scene as the policy reads it: the built-in one it started from, if any, and the graphics it shows. */
export type LiveSceneSource = { preset: LiveOverlayPreset | null; elements: LiveOverlayLayoutElements };

/**
 * The scene a slug draws, from the room's layouts. A built-in scene keeps its
 * slug when the event saves it, and one of the event's own names the built-in
 * it started from; a name the event does not have draws as the default scene,
 * so it brings on what that one does.
 */
export function liveSceneSource(saved: readonly LiveOverlayLayoutGeometry[], slug: string | null): LiveSceneSource {
  const known = slug !== null && (isLiveOverlayPreset(slug) || saved.some((layout) => layout.slug === slug));
  const drawn = known ? slug : LIVE_OVERLAY_DEFAULT_LAYOUT;
  const own = saved.find((layout) => layout.slug === drawn)?.preset ?? null;
  return {
    preset: isLiveOverlayPreset(drawn) ? drawn : own,
    elements: resolveLiveOverlayLayout(saved, drawn),
  };
}

/** The graphics loading this scene puts on: its list, without any graphic the scene does not show. */
export function liveSceneBringsOn(scene: LiveSceneSource): LiveSceneGraphic[] {
  const listed = scene.preset ? LIVE_SCENE_BRINGS_ON[scene.preset] : OWN_SCENE_BRINGS_ON;
  return listed.filter((graphic) => scene.elements[graphic].visible);
}
