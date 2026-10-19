/**
 * The current time, refreshed only when it crosses the next boundary that matters to the caller (a session
 * start or end, a day change) and when the page becomes visible again, since browsers hold back timers in
 * hidden tabs. One timer at a time; no polling.
 */
import { useEffect, useState } from "preact/hooks";

/** setTimeout's largest delay; a later boundary is reached in steps. */
const MAX_DELAY_MS = 2_147_483_647;
/** Wakes just after the boundary so the instant compared is already past it. */
const SETTLE_MS = 250;

export function useBoundaryClock(nextBoundary: (now: number) => number | null): number {
  const [now, setNow] = useState(() => Date.now());
  const boundary = nextBoundary(now);
  useEffect(() => {
    if (boundary === null) return;
    const timer = window.setTimeout(
      () => setNow(Date.now()),
      Math.min(Math.max(boundary - Date.now(), 0) + SETTLE_MS, MAX_DELAY_MS),
    );
    return () => window.clearTimeout(timer);
  }, [boundary, now]);
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") setNow(Date.now());
    };
    document.addEventListener("visibilitychange", refresh);
    return () => document.removeEventListener("visibilitychange", refresh);
  }, []);
  return now;
}
