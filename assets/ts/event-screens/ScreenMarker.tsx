import "./ScreenOfflineDot.css";

/**
 * The one sign that a screen lost its connections: a small dot in the
 * corner, so the output keeps its picture and its timers keep counting
 * without alarming the room.
 */
export function ScreenOfflineDot() {
  return <span class="pk-screen-offline" role="status" aria-label="Offline" title="Offline" />;
}
