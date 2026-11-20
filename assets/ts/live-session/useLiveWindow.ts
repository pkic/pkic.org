import { useEffect, useState } from "preact/hooks";
import { liveRoomOpen, liveRoomTakesQuestions } from "../../shared/live-session-policy";

/**
 * Whether an attendee interaction is open: `live` for chat and reactions, which keep to the room's window, or
 * `questions` for questions and polls, which open as soon as the session is scheduled. Backend admission stays
 * authoritative.
 */
export function useLiveWindow(startAt: string, endAt: string, scope: "live" | "questions" = "live"): boolean {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  return scope === "questions" ? liveRoomTakesQuestions(now, endAt) : liveRoomOpen(now, startAt, endAt);
}
