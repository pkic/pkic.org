import { LIVE_OVERLAY_FRAME, type LiveOverlayElementPlacement } from "./schemas/live-overlay-layout";

/**
 * Where an overlay graphic lands in its layout box. Pure functions, so the
 * browser source, the control room's monitors and the layout editor draw
 * every element in the same place.
 */

/** A rectangle in pixels of the broadcast frame. */
export interface OverlayRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The title-safe margin, as a fraction of each side: graphics inside it survive any display's overscan. */
export const LIVE_OVERLAY_SAFE_MARGIN = 0.05;

/** A placement's box in pixels of the frame. */
export function overlayBoxPixels(placement: Pick<LiveOverlayElementPlacement, "x" | "y" | "w" | "h">): OverlayRect {
  return {
    x: placement.x * LIVE_OVERLAY_FRAME.width,
    y: placement.y * LIVE_OVERLAY_FRAME.height,
    width: placement.w * LIVE_OVERLAY_FRAME.width,
    height: placement.h * LIVE_OVERLAY_FRAME.height,
  };
}

/**
 * The graphic at its natural size scaled to fit the box whole, keeping its
 * shape, and aligned in the box by the placement's anchor.
 */
export function placeOverlayGraphic(placement: LiveOverlayElementPlacement, natural: OverlayRect): OverlayRect {
  const box = overlayBoxPixels(placement);
  if (natural.width <= 0 || natural.height <= 0) return box;
  const scale = Math.min(box.width / natural.width, box.height / natural.height);
  const width = natural.width * scale;
  const height = natural.height * scale;
  const spareX = box.width - width;
  const spareY = box.height - height;
  return {
    x: box.x + (placement.horizontal === "left" ? 0 : placement.horizontal === "right" ? spareX : spareX / 2),
    y: box.y + (placement.vertical === "top" ? 0 : placement.vertical === "bottom" ? spareY : spareY / 2),
    width,
    height,
  };
}

/**
 * The move and uniform scale that take a graphic drawn at `natural` onto its
 * placed rectangle, about the frame's top-left corner. `identity` is true when
 * the graphic already sits exactly where it belongs.
 */
export function liveOverlayLayerTransform(
  placement: LiveOverlayElementPlacement,
  natural: OverlayRect,
): { dx: number; dy: number; scale: number; identity: boolean } {
  const placed = placeOverlayGraphic(placement, natural);
  const scale = natural.width > 0 ? placed.width / natural.width : 1;
  const round = (value: number) => Math.round(value * 1000) / 1000;
  const dx = round(placed.x - natural.x * scale);
  const dy = round(placed.y - natural.y * scale);
  const rounded = Math.round(scale * 10000) / 10000;
  return { dx, dy, scale: rounded, identity: dx === 0 && dy === 0 && rounded === 1 };
}

/**
 * The box scaled by a factor about its anchor: a right-anchored box keeps its
 * right edge, a centered one its center.
 */
export function scaleOverlayBox(placement: LiveOverlayElementPlacement, factor: number): LiveOverlayElementPlacement {
  const w = placement.w * factor;
  const h = placement.h * factor;
  const along = (start: number, size: number, scaled: number, edge: "start" | "center" | "end") =>
    edge === "start" ? start : edge === "end" ? start + size - scaled : start + (size - scaled) / 2;
  const edge = (value: string) =>
    value === "left" || value === "top" ? "start" : value === "right" || value === "bottom" ? "end" : "center";
  return {
    ...placement,
    x: along(placement.x, placement.w, w, edge(placement.horizontal)),
    y: along(placement.y, placement.h, h, edge(placement.vertical)),
    w,
    h,
  };
}

/** The box moved to a corner (or the center) of the title-safe area, at its own size. */
export function anchorOverlayBox(
  placement: LiveOverlayElementPlacement,
  anchor: Pick<LiveOverlayElementPlacement, "horizontal" | "vertical">,
): LiveOverlayElementPlacement {
  const along = (size: number, edge: "start" | "center" | "end") =>
    edge === "start" ? LIVE_OVERLAY_SAFE_MARGIN : edge === "end" ? 1 - LIVE_OVERLAY_SAFE_MARGIN - size : (1 - size) / 2;
  const horizontal = anchor.horizontal === "left" ? "start" : anchor.horizontal === "right" ? "end" : "center";
  const vertical = anchor.vertical === "top" ? "start" : anchor.vertical === "bottom" ? "end" : "center";
  return {
    ...placement,
    ...anchor,
    x: Math.max(0, along(placement.w, horizontal)),
    y: Math.max(0, along(placement.h, vertical)),
  };
}
