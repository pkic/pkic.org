import type { LiveOverlayElementPlacement } from "../../../../../../../../shared/schemas/live-overlay-layout";
import type { LayoutUnit } from "./overlay-layout-editing";
import { formatNumber } from "../../../../../../../../shared/format-number";

/** The scene editor's words, kept together so the canvas, the list and the exact position name things alike. */

/** The canvas's boxes, as one group. */
export const LAYOUT_CANVAS_LABEL = "Graphics on the canvas";

/** The inspector's note on a shared element: moving it here moves it wherever it is shared. */
export function layoutSharingNote(layouts: number): string {
  return layouts > 1
    ? `Shared with ${formatNumber(layouts)} scenes: moving it here moves it on all of them.`
    : "Shared position: moving it here moves it on every scene that shares it.";
}

export const LAYOUT_UNIT_LABEL: Record<LayoutUnit, string> = {
  percent: "Percent",
  pixels: "Pixels (1920 × 1080)",
};

export const LAYOUT_HORIZONTAL_LABEL: Record<LiveOverlayElementPlacement["horizontal"], string> = {
  left: "Left",
  center: "Center",
  right: "Right",
};

export const LAYOUT_VERTICAL_LABEL: Record<LiveOverlayElementPlacement["vertical"], string> = {
  top: "Top",
  middle: "Middle",
  bottom: "Bottom",
};
