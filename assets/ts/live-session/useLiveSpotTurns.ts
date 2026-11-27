import { useEffect, useState } from "preact/hooks";
import { liveOverlayNextTurnAt, liveOverlaySpotTurns, liveOverlaySpots } from "../../shared/live-overlay-spots";
import { resolveLiveSceneElements } from "../../shared/live-scene-elements";
import type { LiveOverlayLayoutElements } from "../../shared/schemas/live-overlay-layout";
import type { LiveRoomState } from "./live-room-state";

/** Wakes this long after a turn starts, so the clock it reads is past the turn's first millisecond. */
const AFTER_TURN_MS = 20;

/**
 * The clock scenes' spots take turns by: the time now, read again as each
 * turn starts while a spot of any of the scenes takes turns. Scenes without
 * one read the clock once and never wake.
 */
export function useLiveSpotTurns(...scenes: LiveOverlayLayoutElements[]): number {
  const [now, setNow] = useState(() => Date.now());
  // The scenes' intervals as one value, so the clock restarts only when they change.
  const intervals = scenes
    .flatMap((elements) => liveOverlaySpots(elements).map((spot) => liveOverlaySpotTurns(elements, spot)))
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

/** The clock the studio reads for Program's and Preview's spots, so its rows say which graphic is next in turn. */
export function useStudioSpotTurns(state: LiveRoomState | null): number {
  return useLiveSpotTurns(...[state?.stage, state?.preview].map((on) => resolveLiveSceneElements(state, on?.scene)));
}
