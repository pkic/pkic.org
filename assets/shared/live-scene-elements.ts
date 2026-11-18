import { LIVE_OVERLAY_DEFAULT_POSITIONS, resolveLiveOverlayLayout } from "./live-overlay-layout-presets";
import { liveProgramLayers, withLiveProgramOrder } from "./live-overlay-stacking";
import type {
  LiveOverlayElement,
  LiveOverlayElementBox,
  LiveOverlayLayoutElements,
  LiveOverlayLayoutGeometry,
} from "./schemas/live-overlay-layout";
import type { LiveLockedGraphics } from "./schemas/live-graphic-locks";

/**
 * What a room draws for one scene: the scene's layout, with the graphics
 * the operators keep in every scene drawn in it whatever the scene shows.
 * The one resolution the outputs, the room screens, the studio's monitors,
 * its scene thumbnails and its rows share, so they always agree.
 */

/** What the resolution reads from the room: the event's layouts and the graphics kept in every scene. */
export type LiveSceneRoom = {
  overlayLayouts: readonly LiveOverlayLayoutGeometry[];
  lockedGraphics: LiveLockedGraphics;
};

/**
 * The event's shared position for an element: the box of any layout that
 * shares it, since every such layout draws it there, else the standard one.
 */
export function liveOverlaySharedBox(
  saved: readonly LiveOverlayLayoutGeometry[],
  element: LiveOverlayElement,
): LiveOverlayElementBox {
  const sharing = saved.find((layout) => layout.elements[element].shared)?.elements[element];
  if (!sharing) return LIVE_OVERLAY_DEFAULT_POSITIONS[element];
  const { x, y, w, h, horizontal, vertical } = sharing;
  return { x, y, w, h, horizontal, vertical };
}

/**
 * A scene with the kept graphics drawn in it: each shown at the event's
 * shared position, over the picture, and stacked in front of the scene's
 * own graphics. Whether one shows is still up to the output that has it on.
 */
export function withLiveLockedGraphics(
  elements: LiveOverlayLayoutElements,
  room: LiveSceneRoom,
): LiveOverlayLayoutElements {
  if (!room.lockedGraphics.length) return elements;
  const locked = new Set<LiveOverlayElement>(room.lockedGraphics);
  const kept = { ...elements };
  for (const graphic of room.lockedGraphics)
    kept[graphic] = { visible: true, shared: true, ...liveOverlaySharedBox(room.overlayLayouts, graphic) };
  const frontToBack = liveProgramLayers(elements).reverse();
  return withLiveProgramOrder(kept, [
    ...frontToBack.filter((layer) => locked.has(layer)),
    ...frontToBack.filter((layer) => !locked.has(layer)),
  ]);
}

/** The elements a scene draws in this room; an unknown scene is drawn as the event's default. */
export function resolveLiveSceneElements(
  room: LiveSceneRoom | null,
  scene: string | null | undefined,
): LiveOverlayLayoutElements {
  const elements = resolveLiveOverlayLayout(room?.overlayLayouts ?? [], scene);
  return room ? withLiveLockedGraphics(elements, room) : elements;
}
