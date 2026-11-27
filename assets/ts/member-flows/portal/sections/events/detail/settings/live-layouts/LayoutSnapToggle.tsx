import { signal } from "@preact/signals";
import { Button } from "../../../../../../../ui/Button";
import { StrokeIcon } from "../../../../../../../ui/MediaIcons";

const SNAP_KEY = "pkic.live-layouts.snap";

/** Whether this viewer's drags snap; on unless they turned it off. */
function readSnapPreference(): boolean {
  try {
    return localStorage.getItem(SNAP_KEY) !== "off";
  } catch {
    return true;
  }
}

/**
 * Whether a drag on the scene canvas snaps to the grid, the frame, the safe
 * areas and the other graphics' edges. One choice for every canvas this
 * viewer opens; Alt held during a drag does the opposite.
 */
export const layoutSnapping = signal(readSnapPreference());

function MagnetIcon() {
  return (
    <StrokeIcon>
      <path d="M3.5 2.5v5.5a4.5 4.5 0 0 0 9 0V2.5h-3v5.5a1.5 1.5 0 0 1-3 0V2.5z" />
      <path d="M3.5 5h3M9.5 5h3" />
    </StrokeIcon>
  );
}

/** Turns snapping on or off for the scene canvas. */
export function LayoutSnapToggle() {
  const on = layoutSnapping.value;
  return (
    <Button
      icon
      variant="ghost"
      aria-pressed={on}
      aria-label="Snap"
      title={`Snap: ${on ? "on" : "off"}\nEdges snap to the grid, the safe areas and other graphics. Hold Alt while dragging to do the opposite.`}
      onClick={() => {
        layoutSnapping.value = !on;
        try {
          localStorage.setItem(SNAP_KEY, on ? "off" : "on");
        } catch {
          // A blocked storage keeps the choice for this visit only.
        }
      }}
    >
      <MagnetIcon />
    </Button>
  );
}
