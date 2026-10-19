import { useEffect, useState } from "preact/hooks";
import { liveRoomOpen } from "../../shared/live-session-policy";

/** One attendee interaction window shared by questions and chat; backend admission stays authoritative. */
export function useLiveWindow(startAt: string, endAt: string): boolean {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  return liveRoomOpen(now, startAt, endAt);
}
