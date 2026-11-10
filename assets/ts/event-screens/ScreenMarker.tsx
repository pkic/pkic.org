import { formatNumber } from "../../shared/format-number";
import { Badge } from "../ui/Badge";
import type { ScreenMarker as Marker } from "./screen-display";
import "./ScreenMarker.css";

/**
 * The screen's status: a small dot while the connection has just dropped,
 * then a badge saying how long the screen has heard nothing, or that it runs
 * its room's agenda on its own. It sits at the end of a page's bottom line
 * when the page has one, so it never covers what the line says; otherwise
 * in the frame's title-safe corner, over the picture, so the output never
 * moves.
 */
export function ScreenMarker({ marker, placement = "line" }: { marker: Marker; placement?: "line" | "corner" }) {
  if (!marker) return null;
  const classes = `pk-screen-marker${placement === "corner" ? " pk-screen-marker--corner" : ""}`;
  if (marker.kind === "offline-dot")
    return <span class={`${classes} pk-screen-marker--dot`} role="status" aria-label="Offline" title="Offline" />;
  return (
    <span class={classes} role="status">
      {marker.kind === "auto" ? (
        <Badge tone="info">Auto mode</Badge>
      ) : (
        <Badge tone="warn">Offline · {formatNumber(marker.minutes)} min</Badge>
      )}
    </span>
  );
}
