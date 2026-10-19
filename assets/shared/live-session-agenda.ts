import { formatDuration, formatEventDayInZone, formatRelativeDays } from "./format-date";
import type { ClockZone } from "./event-clock";
import { formatLiveTimer } from "./live-timer-policy";

/**
 * Where a session stands against the clock and the agenda, for the control
 * room's session bar. The agenda is the reference everyone in the room
 * follows; the desk shows how the active session differs from it and never
 * switches sessions by itself, because sessions start early and run over.
 */

type Window = { startAt: string; endAt: string };

/** Further away than this, a session counts in days rather than hours and minutes. */
const DAYS_FROM_MS = 2 * 24 * 60 * 60_000;

export type LiveSessionTiming =
  | { state: "upcoming"; startsInMs: number }
  | { state: "running"; leftMs: number }
  | { state: "over"; overMs: number }
  | { state: "ended"; agoMs: number };

/**
 * A session before its start, while it runs, and after its end: still the
 * active session there, it is running over; otherwise it has ended. While it
 * runs, the session timer operators adjust is the measure when there is one.
 */
export function liveSessionTiming(
  session: Window,
  now: number,
  active: boolean,
  timerLeftMs: number | null = null,
): LiveSessionTiming {
  const start = Date.parse(session.startAt);
  const end = Date.parse(session.endAt);
  if (now < start) return { state: "upcoming", startsInMs: start - now };
  const left = timerLeftMs ?? end - now;
  if (left > 0) return { state: "running", leftMs: left };
  return active ? { state: "over", overMs: -left } : { state: "ended", agoMs: now - end };
}

/** "12 min", "2 h 15 min": never less than a minute, so a span never reads as nothing. */
const span = (ms: number) => formatDuration(Math.max(ms, 60_000));
const clock = (ms: number) => formatLiveTimer(ms, ms >= 3_600_000 ? "hh:mm:ss" : "mm:ss");

/** "Starts in 12 min", "Starts in 2 h 15 min", "Starts in 49 days", "18:42 left", "+02:15 over", "Ended 10 min ago". */
export function liveSessionTimingText(timing: LiveSessionTiming, session: Window, zone: ClockZone): string {
  switch (timing.state) {
    case "upcoming":
      return timing.startsInMs >= DAYS_FROM_MS
        ? `Starts ${
            formatRelativeDays(session.startAt, Date.parse(session.startAt) - timing.startsInMs) ??
            formatEventDayInZone(session.startAt, zone)
          }`
        : `Starts in ${span(timing.startsInMs)}`;
    case "running":
      return `${clock(timing.leftMs)} left`;
    case "over":
      return `+${clock(timing.overMs)} over`;
    case "ended":
      return timing.agoMs >= DAYS_FROM_MS
        ? `Ended ${formatEventDayInZone(session.endAt, zone)}`
        : `Ended ${span(timing.agoMs)} ago`;
  }
}

/** How the room's active session differs from the session the agenda has now, if it does. */
export type LiveAgendaDrift =
  | { kind: "moved-on"; agendaTitle: string; agoMs: number }
  | { kind: "early"; earlyMs: number }
  | { kind: "other"; agendaTitle: string };

/**
 * The warning for an active session that is not the agenda's: the agenda
 * moved on while it runs over, or it was made active before its start.
 * Null when the active session is the agenda's, or nothing is active.
 */
export function liveAgendaDrift(
  active: Window | null,
  agenda: (Window & { title: string }) | null,
  now: number,
  sameSession: boolean,
): LiveAgendaDrift | null {
  if (!active) return null;
  if (Date.parse(active.startAt) > now) return { kind: "early", earlyMs: Date.parse(active.startAt) - now };
  if (!agenda || sameSession) return null;
  if (Date.parse(agenda.startAt) <= now)
    return { kind: "moved-on", agendaTitle: agenda.title, agoMs: now - Date.parse(agenda.startAt) };
  return { kind: "other", agendaTitle: agenda.title };
}

/**
 * The drift in words, for the session bar. An early start reads with the
 * session's own timing ("Starts in 49 days"), so it needs only a short note.
 */
export function liveAgendaDriftText(drift: LiveAgendaDrift): string {
  switch (drift.kind) {
    case "moved-on":
      return `Agenda moved on to “${drift.agendaTitle}” ${span(drift.agoMs)} ago`;
    case "early":
      return "Active before its start";
    case "other":
      return `Agenda has “${drift.agendaTitle}” next`;
  }
}
