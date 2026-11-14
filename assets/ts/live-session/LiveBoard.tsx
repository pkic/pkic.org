import type { ComponentChildren } from "preact";
import type { OverlayRect } from "../../shared/live-overlay-geometry";
import { useNumericCssProperties } from "../hooks/useNumericCssProperties";
import { PkicMark } from "../ui/PkicMark";
import { OverlayEmblem } from "./LiveEmblem";
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

/**
 * The conference board every audience-facing graphic is drawn on: the
 * conference field, its dots and the mark, the emblem at the top, an eyebrow
 * that names what the board shows, then the graphic. It takes its box's shape,
 * so the same board fills the projector, a band of the stream or a column
 * beside the camera, and each graphic arranges itself for that shape.
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
  const { width, height, shape } = liveBoardSize(box);
  const geometry = useNumericCssProperties({ "--board-width": width, "--board-height": height });
  return (
    <section
      class={`pk-live-board ${className}`}
      aria-label={label}
      data-shape={shape}
      data-numeric-css-properties={geometry}
    >
      <PkicMark class="pk-live-board__watermark" />
      <header class="pk-live-board__head">
        <p class="pk-live-board__eyebrow">{eyebrow}</p>
        <OverlayEmblem />
      </header>
      {children}
    </section>
  );
}
