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
import { LIVE_SPOT_TURN_SECONDS } from "./live-overlay-spots";

/**
 * The built-in scenes, as shared reference data. Boxes are authored in
 * pixels of the 1920 × 1080 frame and stored as fractions of it. The standard
 * boxes below are the event's shared positions until organizers move them,
 * and a built-in scene shares every element it places there; an element a
 * scene places differently (a side column, Break's Up next) is the scene's own.
 */

type Anchor = Pick<LiveOverlayElementPlacement, "horizontal" | "vertical">;

/** A box from pixel edges, at its anchor, included in the scene until `only` leaves it out. */
function box(x: number, y: number, w: number, h: number, anchor: Anchor): LiveOverlayElementPlacement {
  return { visible: true, ...liveOverlayPixelBox(x, y, w, h, anchor), shared: true };
}

const LEFT_MIDDLE: Anchor = { horizontal: "left", vertical: "middle" };
const LEFT_BOTTOM: Anchor = { horizontal: "left", vertical: "bottom" };
const CENTER: Anchor = { horizontal: "center", vertical: "middle" };
const CENTER_BOTTOM: Anchor = { horizontal: "center", vertical: "bottom" };
const RIGHT_TOP: Anchor = { horizontal: "right", vertical: "top" };
const RIGHT_MIDDLE: Anchor = { horizontal: "right", vertical: "middle" };

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
    // Over the camera, at the side away from the column.
    reactions: box(left ? 1492 : 48, 48, 380, 760, left ? RIGHT_MIDDLE : LEFT_MIDDLE),
  };
}

/**
 * Every graphic's standard box: the lower third, timer and ticker in the
 * title-safe area, and each board over the whole frame. The timer keeps the
 * top-right corner, the check-in code the right side under it, Up next the
 * left above the lower third. The background and the QR code have no switch,
 * so they are left out here: a scene that includes one shows it all the time.
 */
const FULL_FRAME: LiveOverlayLayoutElements = {
  background: { ...FILL, visible: false },
  // Down to the title-safe line, bottom-aligned: it sits low with the ticker off, and above it while it is on air.
  lowerThird: box(48, 722, 1248, 304, LEFT_BOTTOM),
  question: FILL,
  poll: FILL,
  timer: box(1536, 48, 336, 120, RIGHT_TOP),
  ticker: box(0, 954, 1920, 126, CENTER_BOTTOM),
  // Up next on the left, clear of the check-in code and ending above the lower third as it sits over the ticker,
  // so they can show together.
  schedule: box(96, 168, 1248, 504, LEFT_MIDDLE),
  panelists: FILL,
  speakerWelcome: { visible: true, ...LIVE_OVERLAY_ADDED_ELEMENT_BOXES.speakerWelcome, shared: true },
  checkIn: box(1392, 216, 480, 648, RIGHT_MIDDLE),
  topQuestions: { visible: true, ...LIVE_OVERLAY_ADDED_ELEMENT_BOXES.topQuestions, shared: true },
  chat: { visible: true, ...LIVE_OVERLAY_ADDED_ELEMENT_BOXES.chat, shared: true },
  qrCode: { visible: false, ...LIVE_OVERLAY_ADDED_ELEMENT_BOXES.qrCode, shared: true },
  reactions: box(1492, 48, 380, 984, RIGHT_MIDDLE),
  stageDisplay: box(0, 0, 1920, 1080, CENTER),
  stageMessage: box(64, 24, 1792, 152, { horizontal: "center", vertical: "top" }),
};

/** Includes only the listed elements; every other one stays where it is, left out of the scene. */
function only(elements: LiveOverlayLayoutElements, shown: readonly LiveOverlayElement[]): LiveOverlayLayoutElements {
  return Object.fromEntries(
    LIVE_OVERLAY_ELEMENTS.map((element) => [element, { ...elements[element], visible: shown.includes(element) }]),
  ) as LiveOverlayLayoutElements;
}

/** The scene with these graphics coming on with it; each must be one that fills itself from the room. */
function comingOn(
  elements: LiveOverlayLayoutElements,
  graphics: readonly LiveOverlayElement[],
): LiveOverlayLayoutElements {
  const next = { ...elements };
  for (const graphic of graphics) next[graphic] = { ...elements[graphic], comesOn: true };
  return next;
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
/**
 * What every built-in scene places and never brings on: the time, the news
 * ticker and reactions are switched in the studio. So is the lower third,
 * in the scenes with a camera picture to caption.
 */
const ALWAYS: readonly LiveOverlayElement[] = ["timer", "ticker", "reactions", ...STAGE];
/** The boards a question round shows, one at a time in the same place. */
const QUESTION_BOARDS: readonly LiveOverlayElement[] = ["question", "topQuestions", "poll"];
/** Every board a side column holds, one at a time in the same place. */
const SIDE_BOARDS: readonly LiveOverlayElement[] = [...QUESTION_BOARDS, "panelists", "checkIn", "chat", "schedule"];
/**
 * A column of boards at one side, the camera beside it, with the background
 * in the column under them. The ticker keeps the full width and the boards
 * keep clear of it.
 */
const column = (side: "left" | "right"): LiveOverlayLayoutElements => ({
  ...FULL_FRAME,
  ...boardColumn(side),
  ticker: FULL_FRAME.ticker,
});

/** Break's column beside the clip, under the time: one spot whose boards take turns. */
const BREAK_SPOT: LiveOverlayElementPlacement = {
  ...box(1376, 192, 496, 666, RIGHT_TOP),
  turns: LIVE_SPOT_TURN_SECONDS,
};

/**
 * The scenes every event starts with, in the studio's order. A scene says
 * where each graphic it includes sits, and which of the graphics that fill
 * themselves from the room come on with it; the operator switches the rest.
 * A scene that includes the background shows it whenever the scene is on,
 * and the boards inside it draw on it.
 */
const PRESETS: Record<LiveOverlayPreset, { name: string; elements: LiveOverlayLayoutElements }> = {
  /**
   * The camera picture with every graphic that has a switch at its standard
   * box, the boards included, and nothing coming on. Whatever the operator
   * switches on shows here. Only the background and the QR code, which have
   * no switch, are left out. Outputs that name no scene draw this one.
   */
  default: {
    name: "Camera",
    elements: only(
      FULL_FRAME,
      LIVE_OVERLAY_ELEMENTS.filter((element) => element !== "background" && element !== "qrCode"),
    ),
  },
  /**
   * Any board in a column on the right, on the background, the camera
   * beside it with the speaker's name, the time and the ticker. The top
   * questions come on with the scene; a question, the poll, the check-in
   * code, the chat or Up next takes their place when switched on.
   */
  questions: {
    name: "Board right",
    elements: comingOn(only(column("right"), ["background", ...SIDE_BOARDS, "lowerThird", ...ALWAYS]), [
      "topQuestions",
    ]),
  },
  /** The same column on the left, for a second board beside the camera; nothing comes on with it. */
  "check-in": {
    name: "Board left",
    elements: only(column("left"), ["background", ...SIDE_BOARDS, "lowerThird", ...ALWAYS]),
  },
  /**
   * One board over the whole frame on the background: a question, the top
   * questions, the poll, the panel, the speaker welcome, the chat or Up next, one at a time; a
   * question picked while the panel is on shows with the panel on one board.
   * No camera picture shows, so the scene places no lower third.
   */
  "full-board": {
    name: "Full board",
    elements: only({ ...FULL_FRAME, schedule: FILL }, [
      "background",
      ...QUESTION_BOARDS,
      "panelists",
      "speakerWelcome",
      "chat",
      "schedule",
      ...ALWAYS,
    ]),
  },
  /**
   * A break over the sponsors' clips. The production places the clip whole,
   * at 16:9, at 48, 48 and 1280 × 720 on its own background; beside it, a
   * column from 1376 to the title-safe edge holds the time until the program
   * is back in its top-right corner and, under it, one spot where Up next,
   * the chat and the top questions take turns, 15 seconds each. Up next comes
   * on with the scene; the chat and the top questions join it when switched
   * on. The ticker, when switched on, runs under them all. Nothing here
   * covers the clip.
   */
  break: {
    name: "Break",
    elements: comingOn(
      only({ ...FULL_FRAME, schedule: BREAK_SPOT, chat: BREAK_SPOT, topQuestions: BREAK_SPOT }, [
        "schedule",
        "chat",
        "topQuestions",
        ...ALWAYS,
      ]),
      ["schedule"],
    ),
  },
};

/**
 * Every graphic with a switch at its standard box, the boards included:
 * what Add graphic and a new scene place a graphic at, and what previews and
 * tests place one in on its own. Camera includes all but the background and the QR code.
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

/** A scene's graphics with the shared ones placed where the event shares them, then made the scene's own. */
export function detachLiveOverlayElements(
  elements: LiveOverlayLayoutElements,
  positions: LiveOverlaySharedPositions,
): LiveOverlayLayoutElements {
  const resolved = resolveLiveOverlayElements(elements, positions);
  return Object.fromEntries(
    LIVE_OVERLAY_ELEMENTS.map((element) => [element, { ...resolved[element], shared: false }]),
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
