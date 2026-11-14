import {
  LIVE_OVERLAY_ADDED_ELEMENT_BOXES,
  LIVE_OVERLAY_DEFAULT_LAYOUT,
  LIVE_OVERLAY_ELEMENTS,
  LIVE_OVERLAY_PRESETS,
  liveOverlayPixelBox,
  type LiveOverlayElement,
  type LiveOverlayElementBox,
  type LiveOverlayElementPlacement,
  type LiveOverlayLayoutElements,
  type LiveOverlaySharedPositions,
  type LiveOverlayLayoutGeometry,
  type LiveOverlayPreset,
} from "./schemas/live-overlay-layout";

/**
 * The built-in layouts, as shared reference data. Boxes are authored in
 * pixels of the 1920 × 1080 frame and stored as fractions of it. Full frame's
 * boxes are the event's shared positions until organizers move them, and a
 * built-in layout shares every element it places where Full frame does; an
 * element a preset places differently (side by side, close-up, panel) is the
 * preset's own.
 */

type Anchor = Pick<LiveOverlayElementPlacement, "horizontal" | "vertical">;

/** A box from pixel edges, at its anchor, shown unless said otherwise. */
function box(x: number, y: number, w: number, h: number, anchor: Anchor, visible = true): LiveOverlayElementPlacement {
  return { visible, ...liveOverlayPixelBox(x, y, w, h, anchor), shared: true };
}

const LEFT_MIDDLE: Anchor = { horizontal: "left", vertical: "middle" };
const LEFT_BOTTOM: Anchor = { horizontal: "left", vertical: "bottom" };
const CENTER: Anchor = { horizontal: "center", vertical: "middle" };
const CENTER_BOTTOM: Anchor = { horizontal: "center", vertical: "bottom" };
const RIGHT_TOP: Anchor = { horizontal: "right", vertical: "top" };
const RIGHT_MIDDLE: Anchor = { horizontal: "right", vertical: "middle" };
const RIGHT_BOTTOM: Anchor = { horizontal: "right", vertical: "bottom" };

/**
 * A board never floats in the frame: it fills the frame, or a full-height
 * column at one side with the camera beside it, so no strip of the camera
 * shows around it.
 */
const BOARD_COLUMN_WIDTH = 768;
const FILL = box(0, 0, 1920, 1080, CENTER);

/** A layout with every board in one full-height column at a side of the frame, the camera filling the rest. */
function boardColumn(side: "left" | "right"): Partial<LiveOverlayLayoutElements> {
  const left = side === "left";
  const column = box(left ? 0 : 1920 - BOARD_COLUMN_WIDTH, 0, BOARD_COLUMN_WIDTH, 1080, {
    horizontal: side,
    vertical: "middle",
  });
  const camera = left ? BOARD_COLUMN_WIDTH : 0;
  return {
    question: column,
    poll: column,
    panelists: column,
    topQuestions: column,
    chat: column,
    schedule: column,
    checkIn: column,
    lowerThird: box(camera + 48, 856, 1056, 192, LEFT_BOTTOM),
    timer: box(left ? 1536 : 1920 - BOARD_COLUMN_WIDTH - 384, 48, 336, 120, RIGHT_TOP),
    ticker: box(camera, 1000, 1920 - BOARD_COLUMN_WIDTH, 80, CENTER_BOTTOM),
    reactions: box(left ? 1492 : 48, 48, 380, 760, left ? RIGHT_MIDDLE : LEFT_MIDDLE, false),
  };
}

/**
 * Today's broadcast: the lower third, timer and ticker in the title-safe
 * area, and each board over the whole frame. The graphics an operator puts on
 * together never overlap: the timer keeps the top-right corner, the check-in
 * code the right side under it, Up next the left above the lower third.
 */
const FULL_FRAME: LiveOverlayLayoutElements = {
  lowerThird: box(48, 776, 1248, 208, LEFT_BOTTOM),
  question: FILL,
  poll: FILL,
  timer: box(1536, 48, 336, 120, RIGHT_TOP),
  ticker: box(0, 1000, 1920, 80, CENTER_BOTTOM),
  // Up next on the left, above the lower third and clear of the check-in code, so the two can show together.
  schedule: box(96, 168, 1248, 584, LEFT_MIDDLE),
  panelists: FILL,
  checkIn: box(1392, 216, 480, 648, RIGHT_MIDDLE),
  topQuestions: { visible: true, ...LIVE_OVERLAY_ADDED_ELEMENT_BOXES.topQuestions, shared: true },
  chat: { visible: true, ...LIVE_OVERLAY_ADDED_ELEMENT_BOXES.chat, shared: true },
  reactions: box(1492, 48, 380, 984, RIGHT_MIDDLE),
  stageDisplay: box(0, 0, 1920, 1080, CENTER),
  stageMessage: box(64, 24, 1792, 152, { horizontal: "center", vertical: "top" }),
};

/** Shows only the listed elements; every other one stays where it is, hidden. */
function only(elements: LiveOverlayLayoutElements, shown: readonly LiveOverlayElement[]): LiveOverlayLayoutElements {
  return Object.fromEntries(
    LIVE_OVERLAY_ELEMENTS.map((element) => [element, { ...elements[element], visible: shown.includes(element) }]),
  ) as LiveOverlayLayoutElements;
}

/** An element's box and alignment, without whether a layout shows or shares it. */
export function liveOverlayBoxOf(placement: LiveOverlayElementBox): LiveOverlayElementBox {
  const { x, y, w, h, horizontal, vertical } = placement;
  return { x, y, w, h, horizontal, vertical };
}

const sameBox = (left: LiveOverlayElementBox, right: LiveOverlayElementBox) =>
  JSON.stringify(liveOverlayBoxOf(left)) === JSON.stringify(liveOverlayBoxOf(right));

/** The shared positions every event starts with: Full frame's boxes. */
export const LIVE_OVERLAY_DEFAULT_POSITIONS = Object.fromEntries(
  LIVE_OVERLAY_ELEMENTS.map((element) => [element, liveOverlayBoxOf(FULL_FRAME[element])]),
) as LiveOverlaySharedPositions;

/** A preset shares each element it places where Full frame does, and keeps its own box for the rest. */
function sharing(elements: LiveOverlayLayoutElements): LiveOverlayLayoutElements {
  return Object.fromEntries(
    LIVE_OVERLAY_ELEMENTS.map((element) => [
      element,
      { ...elements[element], shared: sameBox(elements[element], FULL_FRAME[element]) },
    ]),
  ) as LiveOverlayLayoutElements;
}

const PRESETS: Record<LiveOverlayPreset, { name: string; elements: LiveOverlayLayoutElements }> = {
  "full-frame": { name: "Full frame", elements: FULL_FRAME },
  "lower-third": { name: "Lower third only", elements: only(FULL_FRAME, ["lowerThird"]) },
  /** The boards in a column on the left, the camera or slides beside them. */
  "side-by-side": { name: "Graphics on the left", elements: { ...FULL_FRAME, ...boardColumn("left") } },
  /** The boards in a column on the right, the camera or slides beside them. */
  "side-by-side-right": { name: "Graphics on the right", elements: { ...FULL_FRAME, ...boardColumn("right") } },
  /** A speaker close-up: the name and the time, nothing over the face. */
  "close-up": {
    name: "Close-up",
    elements: only(
      { ...FULL_FRAME, lowerThird: box(48, 824, 1056, 176, LEFT_BOTTOM), timer: box(1512, 48, 360, 128, RIGHT_TOP) },
      ["lowerThird", "timer", "stageDisplay", "stageMessage"],
    ),
  },
  /** A panel on stage: the panelists across the lower half, the question in the upper half, edge to edge. */
  panel: {
    name: "Panel",
    elements: only(
      {
        ...FULL_FRAME,
        panelists: box(0, 540, 1920, 540, CENTER_BOTTOM),
        question: box(0, 0, 1920, 540, { horizontal: "center", vertical: "top" }),
        timer: box(1512, 48, 360, 128, RIGHT_TOP),
      },
      ["panelists", "question", "timer", "ticker", "stageDisplay", "stageMessage"],
    ),
  },
  "ticker-only": { name: "Ticker only", elements: only(FULL_FRAME, ["ticker"]) },
  /**
   * A break, over the sponsors' clips or a holding slide: only the time until
   * the program is back, large in the bottom-right corner above the ticker,
   * so nothing covers the picture.
   */
  break: {
    name: "Break",
    elements: only({ ...FULL_FRAME, timer: box(1392, 808, 480, 172, RIGHT_BOTTOM) }, ["timer", "ticker"]),
  },
};

export const LIVE_OVERLAY_PRESET_LAYOUTS = Object.fromEntries(
  LIVE_OVERLAY_PRESETS.map((preset) => [preset, { ...PRESETS[preset], elements: sharing(PRESETS[preset].elements) }]),
) as Record<LiveOverlayPreset, { name: string; elements: LiveOverlayLayoutElements }>;

/**
 * A layout's elements as its sources draw them: each element it shares at
 * the event's shared position, the others where the layout placed them.
 */
export function resolveLiveOverlayElements(
  elements: LiveOverlayLayoutElements,
  positions: LiveOverlaySharedPositions,
): LiveOverlayLayoutElements {
  return Object.fromEntries(
    LIVE_OVERLAY_ELEMENTS.map((element) => {
      const placement = elements[element];
      return [element, placement.shared ? { ...placement, ...positions[element] } : placement];
    }),
  ) as LiveOverlayLayoutElements;
}

export function isLiveOverlayPreset(slug: string): slug is LiveOverlayPreset {
  return (LIVE_OVERLAY_PRESETS as readonly string[]).includes(slug);
}

/** The layouts an operator can pick from: the built-in ones under their saved names, then the event's own. */
export function liveOverlayLayoutChoices(
  saved: readonly Pick<LiveOverlayLayoutGeometry, "slug" | "name">[],
): Array<{ slug: string; name: string }> {
  const names = new Map(saved.map((layout) => [layout.slug, layout.name]));
  return [
    ...LIVE_OVERLAY_PRESETS.map((slug) => ({ slug, name: names.get(slug) ?? LIVE_OVERLAY_PRESET_LAYOUTS[slug].name })),
    ...saved.filter((layout) => !isLiveOverlayPreset(layout.slug)).map(({ slug, name }) => ({ slug, name })),
  ];
}

/**
 * The geometry a browser source draws: the layout it names as the room
 * resolved it, else the built-in one by that name, else the event's default.
 * An unknown name is not an error; a broadcast never shows one.
 */
export function resolveLiveOverlayLayout(
  saved: readonly LiveOverlayLayoutGeometry[],
  slug: string | null | undefined,
): LiveOverlayLayoutElements {
  const named = (name: string) =>
    saved.find((layout) => layout.slug === name)?.elements ??
    (isLiveOverlayPreset(name) ? LIVE_OVERLAY_PRESET_LAYOUTS[name].elements : undefined);
  return (slug ? named(slug) : undefined) ?? named(LIVE_OVERLAY_DEFAULT_LAYOUT)!;
}
