import { formatNumber } from "../../shared/format-number";
import { Badge } from "../ui/Badge";
import type { ScreenMarker as Marker } from "./screen-display";
import "./ScreenMarker.css";

/**
 * The screen's status over its picture, in one fixed corner so the output
 * never moves: a small dot while the connection has just dropped, then a
 * badge saying how long the screen has heard nothing, or that it runs its
 * room's agenda on its own.
 */
export function ScreenMarker({ marker }: { marker: Marker }) {
  if (!marker) return null;
  if (marker.kind === "offline-dot")
    return <span class="pk-screen-marker pk-screen-marker--dot" role="status" aria-label="Offline" title="Offline" />;
  return (
    <span class="pk-screen-marker" role="status">
      {marker.kind === "auto" ? (
        <Badge tone="info">Auto mode</Badge>
      ) : (
        <Badge tone="warn">Offline · {formatNumber(marker.minutes)} min</Badge>
      )}
    </span>
  );
}
