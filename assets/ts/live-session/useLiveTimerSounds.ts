import { useContext, useEffect, useRef } from "preact/hooks";
import { liveTimerCue, type LiveTimerCue } from "../../shared/live-timer-policy";
import type { LiveRoomSession, LiveTimer } from "../../shared/schemas/live-session-room";
import type { LiveTimerSoundPlace } from "../../shared/schemas/live-session-timer";
import { LiveClockContext } from "./useLiveCountdown";
import { playLiveTimerCue } from "./live-timer-sound";

/** How often a page checks its timers for a cue: well inside the second a countdown shows. */
export const LIVE_TIMER_SOUND_CHECK_MS = 250;
/** A page that slept longer than this between checks skips what it missed instead of playing it late. */
const STALE_AFTER_MS = 5_000;

/**
 * Plays the cues of the timers that sound in this place, once each time the
 * countdown reaches its warning or zero. It checks on its own clock, not on
 * render, and remembers the instant it last checked, so a re-render, a new
 * room state or a reconnect never plays a cue twice. A page opened after a
 * point has passed does not play it.
 */
export function useLiveTimerSounds(
  timers: readonly LiveTimer[],
  session: Pick<LiveRoomSession, "startAt" | "endAt">,
  place: LiveTimerSoundPlace,
  play: (cue: LiveTimerCue) => void = playLiveTimerCue,
) {
  const clock = useContext(LiveClockContext);
  const latest = useRef({ timers, session, play });
  latest.current = { timers, session, play };
  const sounding = timers.some((timer) => timer.sound.places.includes(place));
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
        if (!timer.sound.places.includes(place)) continue;
        const cue = liveTimerCue(timer, session, from, now);
        if (cue) play(cue);
      }
    };
    const interval = setInterval(check, LIVE_TIMER_SOUND_CHECK_MS);
    return () => clearInterval(interval);
  }, [sounding, place, clock]);
}

/** Mounts the cues of one place without drawing anything. */
export function LiveTimerSounds({
  timers,
  session,
  place,
}: {
  timers: readonly LiveTimer[];
  session: Pick<LiveRoomSession, "startAt" | "endAt">;
  place: LiveTimerSoundPlace;
}) {
  useLiveTimerSounds(timers, session, place);
  return null;
}
