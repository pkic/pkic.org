import type { ComponentChildren } from "preact";
import type { OverlayRect } from "../../shared/live-overlay-geometry";
import { useNumericCssProperties } from "../hooks/useNumericCssProperties";
import { PkicMark } from "../ui/PkicMark";
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
  const width = Math.round(Math.max(box.width, LIVE_BOARD_MIN_WIDTH, LIVE_BOARD_MIN_HEIGHT * aspect));
  return {
    width,
    height: Math.round(width / aspect),
    shape: aspect >= 2.4 ? "strip" : aspect >= 1.6 ? "wide" : aspect >= 1.15 ? "medium" : "tall",
  };
}

/** The board's size and shape for its box, as custom properties for the stylesheet. */
function useBoardGeometry(box: Pick<OverlayRect, "width" | "height">) {
  const { width, height, shape } = liveBoardSize(box);
  // Board pixels to one pixel of the frame, so the margins keep to the frame's graphics-safe area at any scale.
  const framePixel = box.width > 0 ? width / box.width : 1;
  const geometry = useNumericCssProperties({
    "--board-width": width,
    "--board-height": height,
    "--board-frame-px": framePixel,
  });
  return { shape, geometry };
}

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
  box: Pick<OverlayRect, "width" | "height">;
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
 * The scene's background: the conference field, its dots and the mark. A
 * scene that includes it shows it whenever the scene is on, once, so the
 * boards on it read as one composition. It carries no logo: branding is
 * the production's, placed per scene there.
 */
export function LiveBoardGround({ box }: { box: Pick<OverlayRect, "width" | "height"> }) {
  const { shape, geometry } = useBoardGeometry(box);
  return (
    <div
      class="pk-live-board pk-live-board--ground"
      aria-hidden="true"
      data-shape={shape}
      data-numeric-css-properties={geometry}
    >
      <PkicMark class="pk-live-board__watermark" />
    </div>
  );
}
