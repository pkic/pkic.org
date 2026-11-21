import { resolveLiveOverlayLayout } from "./live-overlay-layout-presets";
import type { LiveOverlayLayoutElements, LiveOverlayLayoutGeometry } from "./schemas/live-overlay-layout";

/**
 * What a room draws for one scene. The scene alone decides which graphics
 * can show and where: one it does not include is never drawn while that
 * scene is on, whatever an output has switched on. The one resolution the
 * outputs, the room screens, the studio's monitors, its scene thumbnails
 * and its rows share, so they always agree.
 */

/** What the resolution reads from the room: the event's layouts. */
export type LiveSceneRoom = { overlayLayouts: readonly LiveOverlayLayoutGeometry[] };

/** The elements a scene draws in this room; an unknown scene, or one retired since, is drawn as the event's default. */
export function resolveLiveSceneElements(
  room: LiveSceneRoom | null,
  scene: string | null | undefined,
): LiveOverlayLayoutElements {
  return resolveLiveOverlayLayout(room?.overlayLayouts ?? [], scene);
}
