import type { ComponentChildren } from "preact";
import type { LiveFieldTheme } from "../../shared/live-graphic-theme";
import type { OverlayRect } from "../../shared/live-overlay-geometry";
import { LIVE_OVERLAY_FRAME } from "../../shared/schemas/live-overlay-layout";
import { useNumericCssProperties } from "../hooks/useNumericCssProperties";
import { PkicMark } from "../ui/PkicMark";
import "./LiveGraphicTheme.css";
import "./LiveBoard.css";

/**
 * The narrowest a board is set before its layout box scales it. A smaller box
 * scales the whole board down rather than setting its type smaller, so the
 * type keeps its proportions to the board on a corner of the stream as on the
 * projector.
 */
export const LIVE_BOARD_MIN_WIDTH = 1040;

/** The shortest a board is set, so a thin band across the frame still holds a heading and a row of people. */
export const LIVE_BOARD_MIN_HEIGHT = 640;

/**
 * The board's shape, from its box: a thin strip across the frame, a band, a
 * column beside a picture, or between.
 */
export type LiveBoardShape = "strip" | "wide" | "medium" | "tall";

/** The board's own size: its box's shape, at least the minimum width and height. */
export function liveBoardSize(box: Pick<OverlayRect, "width" | "height">): {
  width: number;
  height: number;
  shape: LiveBoardShape;
} {
  const aspect = box.width > 0 && box.height > 0 ? box.width / box.height : 16 / 9;
  // A larger text size lays the board out smaller, so it is scaled up more into the same box.
  const width = Math.round(
    Math.max(box.width, LIVE_BOARD_MIN_WIDTH, LIVE_BOARD_MIN_HEIGHT * aspect) / (box.textSize ?? 1),
  );
  return {
    width,
    height: Math.round(width / aspect),
    shape: aspect >= 2.4 ? "strip" : aspect >= 1.6 ? "wide" : aspect >= 1.15 ? "medium" : "tall",
  };
}

/** A board's box: its size, and where it sits on the frame when the caller knows. */
export type LiveBoardBox = Pick<OverlayRect, "width" | "height"> &
  Partial<Pick<OverlayRect, "x" | "y">> & {
    /** The scene's text size for the board (`textSize`); absent, the size the box gives it. */
    textSize?: number;
  };

/** The frame's graphics-safe margins, in pixels of the frame: from the top and bottom, and from the sides. */
const FRAME_SAFE = { block: 64, inline: 96 };
/** The least a board keeps from its own edges, in pixels of the frame, when it sits well inside the frame. */
const PANEL_INSET = { block: 32, inline: 40 };

/**
 * How far a board's lines keep from its edges, in pixels of the frame: far
 * enough that nothing reaches into the frame's graphics-safe margin, and at
 * least the panel's own inset. A board on the whole frame keeps the safe
 * margin; one in a panel inside the frame keeps only the panel's inset, so its
 * text gets the width. Each axis keeps one inset on both sides, so a board is
 * never lopsided. A box with no position is taken to reach the frame's edges.
 */
export function liveBoardInset(box: LiveBoardBox): { inline: number; block: number } {
  const { width: frameWidth, height: frameHeight } = LIVE_OVERLAY_FRAME;
  const x = box.x ?? 0;
  const y = box.y ?? 0;
  const right = box.x === undefined ? 0 : frameWidth - x - box.width;
  const bottom = box.y === undefined ? 0 : frameHeight - y - box.height;
  return {
    inline: Math.max(PANEL_INSET.inline, FRAME_SAFE.inline - Math.max(0, Math.min(x, right))),
    block: Math.max(PANEL_INSET.block, FRAME_SAFE.block - Math.max(0, Math.min(y, bottom))),
  };
}

/** The board's size, shape and inset for its box, as custom properties for the stylesheet. */
function useBoardGeometry(box: LiveBoardBox) {
  const { width, height, shape } = liveBoardSize(box);
  // Board pixels to one pixel of the frame, so the inset is set in pixels of the frame at any scale.
  const framePixel = box.width > 0 ? width / box.width : 1;
  const inset = liveBoardInset(box);
  const geometry = useNumericCssProperties({
    "--board-width": width,
    "--board-height": height,
    "--board-frame-px": framePixel,
    "--board-inset-inline": inset.inline,
    "--board-inset-block": inset.block,
  });
  return { shape, geometry };
}

/** The mark shows only on a background that takes most of the frame: on smaller panels it would repeat. */
const MARK_MIN_SHARE = 0.6;
export const liveGroundShowsMark = (box: Pick<OverlayRect, "width" | "height">) =>
  box.width >= LIVE_OVERLAY_FRAME.width * MARK_MIN_SHARE && box.height >= LIVE_OVERLAY_FRAME.height * MARK_MIN_SHARE;

/**
 * A board: an eyebrow that names what it shows, then the graphic, in white
 * type. It draws no field or mark of its own: those are the scene's
 * background (`LiveBoardGround`), drawn once per frame, and a board inside
 * the background's box reads on it. It takes its box's shape, so the same
 * board fills the projector, a band of the stream or a column beside the
 * camera, and each graphic arranges itself for that shape.
 */
export function LiveBoard({
  box,
  eyebrow,
  label,
  class: className,
  children,
}: {
  box: LiveBoardBox;
  eyebrow: ComponentChildren;
  label: string;
  class: string;
  children: ComponentChildren;
}) {
  const { shape, geometry } = useBoardGeometry(box);
  return (
    <section
      class={`pk-live-board ${className}`}
      aria-label={label}
      data-shape={shape}
      data-numeric-css-properties={geometry}
    >
      <header class="pk-live-board__head">
        <p class="pk-live-board__eyebrow">{eyebrow}</p>
      </header>
      {children}
    </section>
  );
}

/**
 * The scene's background: the conference field, its dots and the mark, or a
 * see-through panel in the scene's colors. A scene that includes it shows it
 * whenever the scene is on, once, so the boards on it read as one composition.
 * Only a background that takes most of the frame shows the faint mark; a
 * smaller panel goes without, so a frame with several never repeats it.
 */
export function LiveBoardGround({ box, theme }: { box: LiveBoardBox; theme: LiveFieldTheme }) {
  const { shape, geometry } = useBoardGeometry(box);
  return (
    <div
      class="pk-live-board pk-live-board--ground"
      aria-hidden="true"
      data-graphic-theme={theme}
      data-shape={shape}
      data-numeric-css-properties={geometry}
    >
      {liveGroundShowsMark(box) ? <PkicMark class="pk-live-board__watermark" /> : null}
    </div>
  );
}
