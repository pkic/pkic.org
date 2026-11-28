import { liveOverlayBoxOf } from "../../../../../../../../shared/live-overlay-layout-presets";
import {
  LIVE_OVERLAY_ELEMENTS,
  type LiveOverlayElement,
  type LiveOverlayElementPlacement,
  type LiveOverlayLayoutElements,
  type LiveOverlaySharedPositions,
} from "../../../../../../../../shared/schemas/live-overlay-layout";

/**
 * The layout editor's two drafts: the layout's own elements, each shared
 * element already at the shared position, and the event's shared positions.
 * Moving a shared element moves the shared position, so every layout that
 * shares it follows; moving one the layout placed itself moves it here only.
 * Pure, so the canvas, the inspector and the link menu agree.
 */
export interface LayoutDrafts {
  elements: LiveOverlayLayoutElements;
  positions: LiveOverlaySharedPositions;
}

const BOX_KEYS = ["x", "y", "w", "h", "horizontal", "vertical"] as const;

/** One change to an element: its visibility belongs to the layout; its box to whichever owns the position. */
export function changeLayoutElement(
  drafts: LayoutDrafts,
  element: LiveOverlayElement,
  patch: Partial<LiveOverlayElementPlacement>,
): LayoutDrafts {
  const placement = { ...drafts.elements[element], ...patch };
  const elements = { ...drafts.elements, [element]: placement };
  if (!placement.shared || !BOX_KEYS.some((key) => key in patch)) return { ...drafts, elements };
  return { elements, positions: { ...drafts.positions, [element]: liveOverlayBoxOf(placement) } };
}

/**
 * The drafts once the event's shared positions changed under them, from `before` to `after`. A shared position
 * the draft moved stays the draft's; every other one takes the saved position, and the shared graphics in the
 * draft move with it, so both drafts agree on every shared box. The scene's own fields stay as they are.
 */
export function rebaseSharedPositions(
  drafts: LayoutDrafts,
  before: LiveOverlaySharedPositions,
  after: LiveOverlaySharedPositions,
): LayoutDrafts {
  const moved = (element: LiveOverlayElement) =>
    JSON.stringify(drafts.positions[element]) !== JSON.stringify(before[element]);
  const positions = Object.fromEntries(
    LIVE_OVERLAY_ELEMENTS.map((element) => [element, moved(element) ? drafts.positions[element] : after[element]]),
  ) as LiveOverlaySharedPositions;
  const elements = Object.fromEntries(
    LIVE_OVERLAY_ELEMENTS.map((element) => {
      const placement = drafts.elements[element];
      return [element, placement.shared ? { ...placement, ...positions[element] } : placement];
    }),
  ) as LiveOverlayLayoutElements;
  return { elements, positions };
}

/** "Place differently on this layout": the element keeps where it is now, as this layout's own position. */
export function unlinkLayoutElement(drafts: LayoutDrafts, element: LiveOverlayElement): LayoutDrafts {
  return { ...drafts, elements: { ...drafts.elements, [element]: { ...drafts.elements[element], shared: false } } };
}

/** "Use shared position": the element drops this layout's own position and takes the shared one. */
export function relinkLayoutElement(drafts: LayoutDrafts, element: LiveOverlayElement): LayoutDrafts {
  const placement = { ...drafts.elements[element], ...drafts.positions[element], shared: true };
  return { ...drafts, elements: { ...drafts.elements, [element]: placement } };
}

/** "Apply this position to all layouts": this layout's position becomes the shared one, and the layout shares it. */
export function applyLayoutElementToAll(drafts: LayoutDrafts, element: LiveOverlayElement): LayoutDrafts {
  const placement = { ...drafts.elements[element], shared: true };
  return {
    elements: { ...drafts.elements, [element]: placement },
    positions: { ...drafts.positions, [element]: liveOverlayBoxOf(placement) },
  };
}

/**
 * What the layout itself saves for an element: a shared one only by its flag, whether the scene includes it, its
 * place in the stack, whether it comes on with the scene, its spot's turns, whether it is locked and its look.
 */
function ownedBy(placement: LiveOverlayElementPlacement) {
  const flags = {
    comesOn: placement.comesOn === true,
    turns: placement.turns ?? null,
    locked: placement.locked === true,
    qrLook: placement.qrLook ?? null,
    timerLook: placement.timerLook ?? null,
    speakersLook: placement.speakersLook ?? null,
    fieldTheme: placement.fieldTheme ?? null,
    withBoardOnly: placement.withBoardOnly === true,
    textSize: placement.textSize ?? null,
  };
  return placement.shared
    ? { visible: placement.visible, shared: true, layer: placement.layer, ...flags }
    : { ...placement, ...flags };
}

/** Whether the layout's own part changed; a shared element's move is the shared positions' change, not the layout's. */
export function layoutElementsChanged(left: LiveOverlayLayoutElements, right: LiveOverlayLayoutElements): boolean {
  return LIVE_OVERLAY_ELEMENTS.some(
    (element) => JSON.stringify(ownedBy(left[element])) !== JSON.stringify(ownedBy(right[element])),
  );
}

/** How many of the event's layouts share an element's position. */
export function layoutsSharing(
  layouts: ReadonlyArray<{ elements: LiveOverlayLayoutElements }>,
  element: LiveOverlayElement,
): number {
  return layouts.filter((layout) => layout.elements[element].shared).length;
}
