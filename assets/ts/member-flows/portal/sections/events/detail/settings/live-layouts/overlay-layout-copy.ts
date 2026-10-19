import type {
  LiveOverlayComposition,
  LiveOverlayElementPlacement,
} from "../../../../../../../../shared/schemas/live-overlay-layout";
import type { LayoutUnit } from "./overlay-layout-editing";
import { formatNumber } from "../../../../../../../../shared/format-number";

/** The layout editor's words, kept together so the canvas, the list and the inspector name things alike. */

export const LAYOUT_COMPOSITION_LABEL: Record<LiveOverlayComposition, string> = {
  program: "Program, projector and stage preview",
  "stage-display": "Stage display",
};

export const LAYOUT_LAYER_LABEL: Record<LiveOverlayComposition, string> = {
  program: "Program elements",
  "stage-display": "Stage display elements",
};

/** Whether an element takes the event's shared position or this layout's own. */
export const LAYOUT_SHARING_LABEL = { shared: "Shared position", own: "This layout only" } as const;

/** The inspector's note on a shared element: moving it here moves it wherever it is shared. */
export function layoutSharingNote(layouts: number): string {
  return layouts > 1
    ? `Shared with ${formatNumber(layouts)} layouts: moving it here moves it on all of them.`
    : "Shared position: moving it here moves it on every layout that shares it.";
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
