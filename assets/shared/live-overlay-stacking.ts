import {
  LIVE_OVERLAY_MIN_BOX,
  type LiveOverlayElement,
  type LiveOverlayElementPlacement,
  type LiveOverlayLayoutElements,
} from "./schemas/live-overlay-layout";

/**
 * How a scene stacks Program's graphics: which one draws in front where their
 * boxes meet, and the room every other graphic leaves the news ticker while
 * it is on air. Pure, so the outputs, the studio and the scene editor agree.
 */

/** Program's graphics, bottom to top, as every scene stacks them until an organizer orders them. */
export const LIVE_PROGRAM_LAYER_ORDER = [
  "background",
  "panelists",
  "schedule",
  "checkIn",
  "question",
  "lowerThird",
  "poll",
  "topQuestions",
  "chat",
  "qrCode",
  "timer",
  "ticker",
  "reactions",
] as const satisfies readonly LiveOverlayElement[];
export type LiveProgramLayer = (typeof LIVE_PROGRAM_LAYER_ORDER)[number];

export function isLiveProgramLayer(element: LiveOverlayElement): element is LiveProgramLayer {
  return (LIVE_PROGRAM_LAYER_ORDER as readonly string[]).includes(element);
}

/** A graphic's place in the stack: the scene's own layer, else its built-in one. */
function depth(elements: LiveOverlayLayoutElements, layer: LiveProgramLayer): number {
  return elements[layer].layer ?? LIVE_PROGRAM_LAYER_ORDER.indexOf(layer);
}

/** The background stays under every other graphic, whatever order a scene gives the rest. */
const GROUND = "background" satisfies LiveProgramLayer;

/** Whether an organizer can move this graphic in the scene's stack: every one but the background. */
export function isLiveStackableLayer(element: LiveOverlayElement): element is LiveProgramLayer {
  return isLiveProgramLayer(element) && element !== GROUND;
}

/** Program's graphics in this scene, bottom to top: a later one draws over an earlier one. */
export function liveProgramLayers(elements: LiveOverlayLayoutElements): LiveProgramLayer[] {
  const stacked = LIVE_PROGRAM_LAYER_ORDER.filter((layer) => layer !== GROUND).sort(
    (a, b) =>
      depth(elements, a) - depth(elements, b) ||
      LIVE_PROGRAM_LAYER_ORDER.indexOf(a) - LIVE_PROGRAM_LAYER_ORDER.indexOf(b),
  );
  return [GROUND, ...stacked];
}

/** The scene with its graphics stacked in this order, front first, as the scene editor lists them. */
export function withLiveProgramOrder(
  elements: LiveOverlayLayoutElements,
  frontToBack: readonly LiveProgramLayer[],
): LiveOverlayLayoutElements {
  const bottomUp = [...frontToBack].reverse();
  const next = { ...elements };
  bottomUp.forEach((layer, index) => {
    next[layer] = { ...elements[layer], layer: index };
  });
  return next;
}

/** One graphic moved a place toward the front (-1) or the back (+1) of the editor's front-first list. */
export function moveLiveProgramLayer(
  elements: LiveOverlayLayoutElements,
  layer: LiveProgramLayer,
  direction: -1 | 1,
): LiveOverlayLayoutElements {
  const frontToBack = liveProgramLayers(elements).reverse();
  const from = frontToBack.indexOf(layer);
  const to = from + direction;
  // The background is last in the list and never trades places.
  if (layer === GROUND || to < 0 || to >= frontToBack.length - 1) return elements;
  [frontToBack[from], frontToBack[to]] = [frontToBack[to]!, frontToBack[from]!];
  return withLiveProgramOrder(elements, frontToBack);
}

const EDGE = 0.001;
/** The breathing room a floating graphic keeps from the ticker: 24 pixels on a 1080-pixel frame. */
const TICKER_GAP = 24 / 1080;
/** Graphics that never give way to the ticker: the ticker itself, and reactions floating over everything. */
const OVER_THE_TICKER: ReadonlySet<LiveOverlayElement> = new Set(["ticker", "reactions"]);

/**
 * A box kept clear of the ticker. A board that runs to the frame's edge under
 * the ticker ends flush on it, so its background has no seam. A floating
 * graphic is pushed away by its overlap plus a small gap, keeping its size, and
 * is shortened only where the frame's edge stops the push.
 */
function clear(
  placement: LiveOverlayElementPlacement,
  ticker: LiveOverlayElementPlacement,
): LiveOverlayElementPlacement {
  const across = Math.min(placement.x + placement.w, ticker.x + ticker.w) - Math.max(placement.x, ticker.x);
  if (across <= EDGE) return placement;
  const below = ticker.y + ticker.h / 2 >= 0.5;
  const bleeds = below ? placement.y + placement.h >= 1 - EDGE : placement.y <= EDGE;
  if (below) {
    const limit = ticker.y - (bleeds ? 0 : TICKER_GAP);
    if (placement.y + placement.h <= limit + EDGE || placement.y >= ticker.y) return placement;
    if (bleeds) return shortened(placement, placement.y, limit - placement.y);
    const y = Math.max(0, limit - placement.h);
    return shortened(placement, y, limit - y);
  }
  const limit = ticker.y + ticker.h + (bleeds ? 0 : TICKER_GAP);
  if (placement.y >= limit - EDGE || placement.y + placement.h <= ticker.y + ticker.h) return placement;
  if (bleeds) return shortened(placement, limit, placement.y + placement.h - limit);
  const end = Math.min(1, limit + placement.h);
  return shortened(placement, limit, end - limit);
}

/** The box at its new edges, unless that leaves it smaller than any box may be. */
function shortened(placement: LiveOverlayElementPlacement, y: number, h: number): LiveOverlayElementPlacement {
  return h >= LIVE_OVERLAY_MIN_BOX ? { ...placement, y, h } : placement;
}

/**
 * The scene as drawn while the ticker is on air: every other Program graphic
 * whose box reaches into the ticker's band moves or ends short of it, so
 * nothing runs under it (see `clear`). With the ticker off, the scene is
 * drawn as it is.
 */
export function liveOverlayClearOfTicker(
  elements: LiveOverlayLayoutElements,
  tickerOnAir: boolean,
): LiveOverlayLayoutElements {
  const ticker = elements.ticker;
  if (!tickerOnAir || !ticker.visible) return elements;
  const next = { ...elements };
  for (const layer of LIVE_PROGRAM_LAYER_ORDER) {
    if (!OVER_THE_TICKER.has(layer) && elements[layer].visible) next[layer] = clear(elements[layer], ticker);
  }
  return next;
}
