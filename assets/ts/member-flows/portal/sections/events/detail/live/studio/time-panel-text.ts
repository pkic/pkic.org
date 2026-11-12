import { clockTimeZone, type ClockZone } from "../../../../../../../../shared/event-clock";
import {
  formatClockInZone,
  formatClockName,
  formatDateTimeInZone,
  formatDuration,
} from "../../../../../../../../shared/format-date";
import { formatNumber } from "../../../../../../../../shared/format-number";
import { liveTimerTone, liveTimerTotalMs } from "../../../../../../../../shared/live-timer-policy";
import type { LiveRoomSession, LiveTimer } from "../../../../../../../../shared/schemas/live-session-room";
import { defaultLiveTimerGraphic } from "../../../../../../../../shared/schemas/live-session-timer";
import { instantToCalendarDate } from "../../../../../../../../shared/timezone";

type SessionTime = Pick<LiveRoomSession, "startAt" | "endAt" | "timeZone">;

/** The control room warns as the graphics do by default: in the last two minutes, and once over. */
const PANEL_THRESHOLDS = defaultLiveTimerGraphic("session");

/** "warn" in the last minutes of a countdown, "danger" once it is over. */
export function liveTimeTone(timer: Pick<LiveTimer, "kind">, valueMs: number): "danger" | "warn" | undefined {
  const tone = liveTimerTone(timer, valueMs, PANEL_THRESHOLDS);
  return tone === "over" ? "danger" : tone;
}

/** What a timer counts towards on the event's clock, then what it does at zero and whether it sounds. */
export function timerDetail(timer: LiveTimer, session: SessionTime, clock: ClockZone): string {
  const parts = [kindDetail(timer, session, clock)];
  if (timer.atZero.action === "stop") parts.push("stops at zero");
  if (timer.atZero.action === "reset")
    parts.push(
      timer.atZero.resetAfterSeconds
        ? `resets ${formatNumber(timer.atZero.resetAfterSeconds)} s over`
        : "resets at zero",
    );
  if (timer.sound.places.length) parts.push("sound on");
  return parts.join(" · ");
}

function kindDetail(timer: LiveTimer, session: SessionTime, clock: ClockZone): string {
  switch (timer.kind) {
    case "session":
      return timer.followsAgenda
        ? `Agenda, ${formatClockInZone(session.startAt, clock)} to ${formatClockInZone(session.endAt, clock)}`
        : `${formatDuration(liveTimerTotalMs(timer, session) ?? 0)} session`;
    case "until":
      return timer.targetAt ? `Until ${onClock(timer.targetAt, session, clock)}` : "Until a time";
    case "duration":
      return formatDuration((timer.durationSeconds ?? 0) * 1000);
    case "stopwatch":
      return "Stopwatch";
    case "clock":
      return `Time of day, ${formatClockName(session.timeZone)}`;
  }
}

/** A time on the event's clock; with its date when it falls on another day than the session. */
function onClock(instant: string, session: SessionTime, clock: ClockZone): string {
  const zone = clockTimeZone(clock);
  return instantToCalendarDate(instant, zone) === instantToCalendarDate(session.startAt, zone)
    ? formatClockInZone(instant, clock)
    : formatDateTimeInZone(instant, clock);
}
