import {
  LIVE_OVERLAY_ELEMENT_SWITCHES,
  type LiveOverlayElement,
  type LiveOverlayElementPlacement,
  type LiveOverlayElementSwitch,
} from "../../../../../../../../shared/schemas/live-overlay-layout";
import type { LayoutUnit } from "./overlay-layout-editing";
import { formatNumber } from "../../../../../../../../shared/format-number";

/** The scene editor's words, kept together so the canvas, the list and the exact position name things alike. */

/** The canvas's boxes, as one group. */
export const LAYOUT_CANVAS_LABEL = "Graphics on the canvas";

/** A second line under a graphic in Add graphic, where its name alone does not say what it draws. */
export const LAYOUT_GRAPHIC_DESCRIPTIONS: Partial<Record<LiveOverlayElement, string>> = {
  background: "The conference field, for boards to sit on",
};

/**
 * The two choices a scene has for a graphic that fills itself from the room,
 * each with one sentence on what it does in the studio.
 */
export const LAYOUT_SWITCH_CHOICES = [
  {
    comesOn: true,
    label: "Comes on with the scene",
    help: "Loading this scene switches it on. You can still switch it off in the studio.",
  },
  {
    comesOn: false,
    label: "Switched in the studio",
    help: "The scene only places it. It stays on or off as you left it.",
  },
] as const;

/** What puts a graphic on when the scene has no choice to make for it. */
const LAYOUT_SWITCH_NOTES: Record<Exclude<LiveOverlayElementSwitch, "room">, string> = {
  pick: "On when you pick one in the studio",
  scene: "On whenever this scene is on",
};

/** The choice a scene made for a graphic that fills itself from the room. */
export function layoutSwitchChoice(placement: Pick<LiveOverlayElementPlacement, "comesOn">) {
  return LAYOUT_SWITCH_CHOICES.find((choice) => choice.comesOn === (placement.comesOn === true))!;
}

/**
 * What puts a graphic on in this scene, as its row says it: the scene's
 * choice for one that fills itself from the room, else the one way its type
 * is switched. Read from the declared property, never from a graphic's name.
 */
export function describeGraphicSwitch(
  element: LiveOverlayElement,
  placement: Pick<LiveOverlayElementPlacement, "comesOn">,
): string {
  const by: LiveOverlayElementSwitch = LIVE_OVERLAY_ELEMENT_SWITCHES[element];
  return by === "room" ? layoutSwitchChoice(placement).label : LAYOUT_SWITCH_NOTES[by];
}

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
