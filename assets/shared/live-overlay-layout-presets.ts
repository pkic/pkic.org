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
 * The built-in scenes, as shared reference data. Boxes are authored in
 * pixels of the 1920 × 1080 frame and stored as fractions of it. The standard
 * boxes below are the event's shared positions until organizers move them,
 * and a built-in scene shares every element it places there; an element a
 * scene places differently (a column, the panel) is the scene's own.
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
    background: column,
    question: column,
    poll: column,
    panelists: column,
    topQuestions: column,
    chat: column,
    schedule: column,
    checkIn: column,
    lowerThird: box(camera + 48, 738, 1056, 288, LEFT_BOTTOM),
    timer: box(left ? 1536 : 1920 - BOARD_COLUMN_WIDTH - 384, 48, 336, 120, RIGHT_TOP),
    ticker: box(camera, 954, 1920 - BOARD_COLUMN_WIDTH, 126, CENTER_BOTTOM),
    reactions: box(left ? 1492 : 48, 48, 380, 760, left ? RIGHT_MIDDLE : LEFT_MIDDLE, false),
  };
}

/**
 * Every graphic's standard box: the lower third, timer and ticker in the
 * title-safe area, and each board over the whole frame. The graphics an
 * operator puts on together never overlap: the timer keeps the top-right
 * corner, the check-in code the right side under it, Up next the left above
 * the lower third.
 */
const FULL_FRAME: LiveOverlayLayoutElements = {
  // The conference field over the whole frame, off: a scene with boards shows it where they sit, under them.
  background: { ...FILL, visible: false },
  // Down to the title-safe line, bottom-aligned: it sits low with the ticker off, and above it while it is on air.
  lowerThird: box(48, 722, 1248, 304, LEFT_BOTTOM),
  question: FILL,
  poll: FILL,
  timer: box(1536, 48, 336, 120, RIGHT_TOP),
  ticker: box(0, 954, 1920, 126, CENTER_BOTTOM),
  // Up next on the left, above the lower third and clear of the check-in code, so the two can show together.
  schedule: box(96, 168, 1248, 584, LEFT_MIDDLE),
  panelists: FILL,
  checkIn: box(1392, 216, 480, 648, RIGHT_MIDDLE),
  topQuestions: { visible: true, ...LIVE_OVERLAY_ADDED_ELEMENT_BOXES.topQuestions, shared: true },
  chat: { visible: true, ...LIVE_OVERLAY_ADDED_ELEMENT_BOXES.chat, shared: true },
  // Off until an organizer puts it in a scene: it then shows whenever the scene is on air.
  qrCode: { visible: false, ...LIVE_OVERLAY_ADDED_ELEMENT_BOXES.qrCode, shared: true },
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

/** What every scene keeps for the speaker: the stage display and its messages, never on the stream. */
const STAGE: readonly LiveOverlayElement[] = ["stageDisplay", "stageMessage"];
/** The graphics an operator can put on in every scene: the time and the news ticker. */
const ALWAYS: readonly LiveOverlayElement[] = ["timer", "ticker", ...STAGE];
/** The boards a question round shows, one at a time in the same place. */
const QUESTION_BOARDS: readonly LiveOverlayElement[] = ["question", "topQuestions", "poll"];
/**
 * A column of boards at one side, the camera beside it, with the conference
 * field in the column under them. The ticker keeps the full width and the
 * boards keep clear of it.
 */
const column = (side: "left" | "right"): LiveOverlayLayoutElements => ({
  ...FULL_FRAME,
  ...boardColumn(side),
  ticker: FULL_FRAME.ticker,
});

/**
 * The scenes every event starts with, in the studio's order. A scene is a
 * layout only: it says where each graphic it shows sits, and the operator
 * puts each one on or off. Every scene shows the timer and the ticker. A
 * scene with boards places the background, the conference field, where they
 * sit, under them; the outputs draw it only while a board on it is on air.
 */
const PRESETS: Record<LiveOverlayPreset, { name: string; elements: LiveOverlayLayoutElements }> = {
  /**
   * The event's default, drawn by an output that names no scene: every
   * graphic that is not a board at its standard box, over the picture, with
   * no field. A board shows in another scene.
   */
  default: {
    name: "Default",
    elements: only(FULL_FRAME, ["lowerThird", "schedule", "checkIn", "reactions", ...ALWAYS]),
  },
  /** A talk: the speaker's name, the time, the ticker and reactions over the camera. */
  talk: { name: "Talk", elements: only(FULL_FRAME, ["lowerThird", "reactions", ...ALWAYS]) },
  /** Questions in a column on the right, the speaker's name and the time on the camera beside them. */
  questions: {
    name: "Q&A",
    elements: only(column("right"), ["background", ...QUESTION_BOARDS, "lowerThird", ...ALWAYS]),
  },
  /**
   * A panel on stage: the panelists across the lower half, the question in
   * the upper half, edge to edge, on one background over the whole frame:
   * one board with one logo while both are on. The time keeps its standard
   * corner, and the field's logo steps aside for it.
   */
  panel: {
    name: "Panel",
    elements: only(
      {
        ...FULL_FRAME,
        panelists: box(0, 540, 1920, 540, CENTER_BOTTOM),
        question: box(0, 0, 1920, 540, { horizontal: "center", vertical: "top" }),
      },
      ["background", "panelists", "question", ...ALWAYS],
    ),
  },
  /**
   * A break, over the sponsors' clips or a holding slide: the time until the
   * program is back, large in the bottom-right corner above the ticker, and
   * Up next at its standard place on the left, clear of it.
   */
  break: {
    name: "Break",
    elements: only({ ...FULL_FRAME, timer: box(1392, 758, 480, 172, RIGHT_BOTTOM) }, ["schedule", ...ALWAYS]),
  },
  /**
   * The check-in code in a column on the left on the background, large
   * enough to scan from the room, with Up next and the speaker's name on the
   * camera beside it, above the lower third and under the time.
   */
  "check-in": {
    name: "Check-in",
    elements: only({ ...column("left"), schedule: box(816, 192, 1056, 432, LEFT_MIDDLE) }, [
      "background",
      "checkIn",
      "schedule",
      "lowerThird",
      ...ALWAYS,
    ]),
  },
  /**
   * One board over the whole frame on the background: a question, the poll,
   * the panel, the chat or Up next, with only the time and the ticker over it.
   */
  "full-board": {
    name: "Full board",
    elements: only({ ...FULL_FRAME, schedule: FILL }, [
      "background",
      ...QUESTION_BOARDS,
      "panelists",
      "chat",
      "schedule",
      ...ALWAYS,
    ]),
  },
};

/**
 * Every graphic at its standard box, all shown: the base a scene starts
 * from, and what previews and tests place a graphic in on its own.
 */
export const LIVE_OVERLAY_STANDARD_ELEMENTS: LiveOverlayLayoutElements = sharing(FULL_FRAME);

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
