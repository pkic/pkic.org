import { useEffect, useState } from "preact/hooks";
import { liveRoomOpen, liveRoomTakesQuestions } from "../../shared/live-session-policy";
import type { LiveRoomOpening } from "../../shared/schemas/live-room-opening";

/**
 * Whether an attendee interaction is open: `live` for chat and reactions, which keep to the room's window, or
 * `questions` for questions and polls, which open as soon as the session is scheduled. An operator who opened or
 * closed the room decides instead, once the room has said so. Backend admission stays authoritative.
 */
export function useLiveWindow(
  startAt: string,
  endAt: string,
  scope: "live" | "questions" = "live",
  opening: LiveRoomOpening = "scheduled",
): boolean {
  const now = useMinuteClock();
  return scope === "questions"
    ? liveRoomTakesQuestions(now, endAt, opening)
    : liveRoomOpen(now, startAt, endAt, opening);
}

/** The time now, read again every 30 seconds. */
export function useMinuteClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}
