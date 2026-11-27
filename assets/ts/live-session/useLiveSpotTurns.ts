import { useEffect, useState } from "preact/hooks";
import { liveOverlayNextTurnAt, liveOverlaySpotTurns, liveOverlaySpots } from "../../shared/live-overlay-spots";
import type { LiveOverlayLayoutElements } from "../../shared/schemas/live-overlay-layout";

/** Wakes this long after a turn starts, so the clock it reads is past the turn's first millisecond. */
const AFTER_TURN_MS = 20;

/**
 * The clock a scene's spots take turns by: the time now, read again as each
 * turn starts while a spot of the scene takes turns. A scene without one
 * reads the clock once and never wakes.
 */
export function useLiveSpotTurns(elements: LiveOverlayLayoutElements): number {
  const [now, setNow] = useState(() => Date.now());
  // The scene's intervals as one value, so the clock restarts only when they change.
  const intervals = liveOverlaySpots(elements)
    .map((spot) => liveOverlaySpotTurns(elements, spot))
    .filter((turns): turns is number => turns !== null)
    .join(",");
  useEffect(() => {
    if (!intervals) return;
    // A scene that starts taking turns reads the clock now, so every screen agrees on the turn at once.
    setNow(Date.now());
    const seconds = intervals.split(",").map(Number);
    // Every spot reads one clock, so the next turn of any spot is the next time to look.
    const untilNextTurn = (at: number) =>
      Math.min(...seconds.map((turns) => liveOverlayNextTurnAt(turns, at))) - at + AFTER_TURN_MS;
    let timer = setTimeout(function wake() {
      const at = Date.now();
      setNow(at);
      timer = setTimeout(wake, untilNextTurn(at));
    }, untilNextTurn(Date.now()));
    return () => clearTimeout(timer);
  }, [intervals]);
  return now;
}
