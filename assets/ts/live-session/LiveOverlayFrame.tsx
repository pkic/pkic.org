import type { ComponentChildren } from "preact";
import "./LiveOverlay.css";

/**
 * The 1920 × 1080 canvas every output draws on, scaled whole to fit the box
 * that shows it: a browser source's window, a monitor tile, a venue screen.
 */
export function LiveOverlayFrame({
  view,
  status,
  children,
}: {
  /** What the canvas shows, for the stylesheet: an overlay output or a screen's own view. */
  view: string;
  status?: string;
  children: ComponentChildren;
}) {
  return (
    <div class="pk-live-overlay__frame">
      <div class="pk-live-overlay" data-view={view} data-status={status}>
        {children}
      </div>
    </div>
  );
}
