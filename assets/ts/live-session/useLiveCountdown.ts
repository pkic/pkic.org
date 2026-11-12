import { createContext } from "preact";
import { useContext, useEffect, useState } from "preact/hooks";
import { liveTimerGraphicText } from "../../shared/live-stage-display-plan";
import { liveTimerReading, type LiveTimerReading } from "../../shared/live-timer-policy";
import type { LiveRoomSession, LiveTimer, LiveTimerGraphic } from "../../shared/schemas/live-session-room";

type SessionTime = Pick<LiveRoomSession, "startAt" | "endAt">;

/** Where countdowns read the time: the device clock, or a page's clock corrected to the server's. */
export type LiveClock = () => number;
export const LiveClockContext = createContext<LiveClock>(() => Date.now());

/** The current instant, ticking every second while a timer's reading moves and holding still while it does not. */
export function useLiveTimerNow(ticking: boolean): number {
  const clock = useContext(LiveClockContext);
  const [now, setNow] = useState(() => clock());
  useEffect(() => {
    setNow(clock());
    if (!ticking) return;
    const tick = setInterval(() => setNow(clock()), 1000);
    return () => clearInterval(tick);
  }, [ticking, clock]);
  return now;
}

const IDLE: LiveTimerReading = { valueMs: 0, running: false, startsInMs: null, ticking: false };

/** The instant a timer is read at, ticking while its reading moves. */
function useTimerNow(timer: LiveTimer | undefined, session: SessionTime): number {
  const clock = useContext(LiveClockContext);
  return useLiveTimerNow(timer ? liveTimerReading(timer, session, clock()).ticking : false);
}

/** What a timer reads now, ticking while it moves; a still reading without a timer. */
export function useLiveTimerReading(timer: LiveTimer | undefined, session: SessionTime): LiveTimerReading {
  const now = useTimerNow(timer, session);
  return timer ? liveTimerReading(timer, session, now) : IDLE;
}

/** What a timer graphic reads now: its text, its warning or overrun tone and its label; null without its timer. */
export function useLiveTimerGraphicReading(
  graphic: LiveTimerGraphic,
  timers: readonly LiveTimer[],
  session: SessionTime & Pick<LiveRoomSession, "timeZone">,
) {
  const timer = timers.find((entry) => entry.id === graphic.timerId);
  const now = useTimerNow(timer, session);
  return timer ? liveTimerGraphicText(graphic, timer, session, now) : null;
}
