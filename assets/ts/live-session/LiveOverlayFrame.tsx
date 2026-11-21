import type { ComponentChildren } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";
import "./LiveOverlay.css";

/** A box on the canvas, in fractions of its width and height. */
interface OverlayFrameBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The 1920 × 1080 canvas every output draws on, scaled whole to fit the box
 * that shows it: a browser source's window, a monitor tile, a venue screen.
 * Cropped, it fits one graphic's box to that window instead, so a source can
 * carry that graphic alone for the production software to place.
 */
export function LiveOverlayFrame({
  view,
  status,
  crop = null,
  children,
}: {
  /** What the canvas shows, for the stylesheet: an overlay output or a screen's own view. */
  view: string;
  status?: string;
  /** The graphic's box the window shows, or null for the whole canvas. */
  crop?: OverlayFrameBox | null;
  children: ComponentChildren;
}) {
  const frame = useRef<HTMLDivElement>(null);
  // The box reaches the stylesheet as custom properties rather than markup, as a layer's placement does.
  useLayoutEffect(() => {
    const node = frame.current;
    if (!node) return;
    for (const [name, value] of [
      ["--crop-x", crop?.x],
      ["--crop-y", crop?.y],
      ["--crop-w", crop?.w],
      ["--crop-h", crop?.h],
    ] as const)
      if (value === undefined) node.style.removeProperty(name);
      else node.style.setProperty(name, String(value));
  }, [crop?.x, crop?.y, crop?.w, crop?.h]);
  return (
    <div ref={frame} class="pk-live-overlay__frame" data-crop={crop ? "" : undefined}>
      <div class="pk-live-overlay" data-view={view} data-status={status}>
        {children}
      </div>
    </div>
  );
}
