import { useContext, useEffect, useRef } from "preact/hooks";
import { liveTimerCue, type LiveTimerCue } from "../../shared/live-timer-policy";
import type { LiveRoomSession, LiveTimer } from "../../shared/schemas/live-session-room";
import { LiveClockContext } from "./useLiveCountdown";
import { playLiveTimerCue } from "./live-timer-sound";

/** How often a page checks its timers for a cue: well inside the second a countdown shows. */
export const LIVE_TIMER_SOUND_CHECK_MS = 250;
/** A page that slept longer than this between checks skips what it missed instead of playing it late. */
const STALE_AFTER_MS = 5_000;

/**
 * Plays the cues of the timers this feed shows, once each time the
 * countdown reaches its warning or zero. It checks on its own clock, not on
 * render, and remembers the instant it last checked, so a re-render, a new
 * room state or a reconnect never plays a cue twice. A page opened after a
 * point has passed does not play it.
 */
export function useLiveTimerSounds(
  timers: readonly LiveTimer[],
  session: Pick<LiveRoomSession, "startAt" | "endAt">,
  play: (cue: LiveTimerCue) => void = playLiveTimerCue,
) {
  const clock = useContext(LiveClockContext);
  const latest = useRef({ timers, session, play });
  latest.current = { timers, session, play };
  const sounding = timers.some((timer) => timer.sound.warningSeconds !== null || timer.sound.zero);
  useEffect(() => {
    if (!sounding) return;
    let checkedAt = clock();
    const check = () => {
      const now = clock();
      const from = checkedAt;
      checkedAt = now;
      if (now - from > STALE_AFTER_MS) return;
      const { timers, session, play } = latest.current;
      for (const timer of timers) {
        const cue = liveTimerCue(timer, session, from, now);
        if (cue) play(cue);
      }
    };
    const interval = setInterval(check, LIVE_TIMER_SOUND_CHECK_MS);
    return () => clearInterval(interval);
  }, [sounding, clock]);
}

/** Mounts the cues of a feed's timers without drawing anything. */
export function LiveTimerSounds({
  timers,
  session,
}: {
  timers: readonly LiveTimer[];
  session: Pick<LiveRoomSession, "startAt" | "endAt">;
}) {
  useLiveTimerSounds(timers, session);
  return null;
}
