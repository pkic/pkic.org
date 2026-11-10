import { createContext } from "preact";
import { useContext, useEffect, useState } from "preact/hooks";
import { formatLiveTimer, liveTimerShownMs, liveTimerTone, liveTimerValue } from "../../shared/live-timer-policy";
import type { LiveRoomSession, LiveTimer, LiveTimerGraphic } from "../../shared/schemas/live-session-room";

/** Where countdowns read the time: the device clock, or a page's clock corrected to the server's. */
export type LiveClock = () => number;
export const LiveClockContext = createContext<LiveClock>(() => Date.now());

/** The current instant, ticking every second while a timer runs and holding still while it is paused. */
export function useLiveTimerNow(running: boolean): number {
  const clock = useContext(LiveClockContext);
  const [now, setNow] = useState(() => clock());
  useEffect(() => {
    setNow(clock());
    if (!running) return;
    const tick = setInterval(() => setNow(clock()), 1000);
    return () => clearInterval(tick);
  }, [running, clock]);
  return now;
}

/** A timer's value now: a countdown's time left (negative once over) or a stopwatch's time counted. */
export function useLiveTimerValue(timer: LiveTimer | undefined): number {
  const now = useLiveTimerNow(timer?.running ?? false);
  return timer ? liveTimerValue(timer, now) : 0;
}

/** What a timer graphic reads now: its text, its warning or overrun tone and its label; null without its timer. */
export function useLiveTimerReading(
  graphic: LiveTimerGraphic,
  timers: readonly LiveTimer[],
  session: Pick<LiveRoomSession, "startAt" | "endAt">,
) {
  const timer = timers.find((entry) => entry.id === graphic.timerId);
  const now = useLiveTimerNow(timer?.running ?? false);
  if (!timer) return null;
  const value = liveTimerValue(timer, now);
  return {
    timer,
    text: formatLiveTimer(liveTimerShownMs(timer, graphic, session, now), graphic.format, graphic.customFormat),
    tone: liveTimerTone(timer, value, graphic),
    label: graphic.showLabel ? (graphic.label ?? timer.name) : null,
  };
}
