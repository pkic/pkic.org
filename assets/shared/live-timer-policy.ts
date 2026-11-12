import { anchorOverlayBox, scaleOverlayBox } from "./live-overlay-geometry";
import type { LiveOverlayElementPlacement } from "./schemas/live-overlay-layout";
import {
  DEFAULT_LIVE_TIMER_AT_ZERO,
  DEFAULT_LIVE_TIMER_SOUND,
  LIVE_TIMER_MAX_MS,
  liveTimerResetsAtZero,
  type LiveTimer,
  type LiveTimerAction,
  type LiveTimerDraft,
  type LiveTimerGraphic,
  type LiveTimerSettings,
} from "./schemas/live-session-timer";

/**
 * How a room's timers count, for the room and every browser alike. A
 * countdown runs to an anchor instant and holds its time left while paused;
 * a stopwatch runs from an anchor and holds its time counted. A session
 * timer that follows the agenda reads the session's own times instead.
 *
 * What happens at zero is derived from the stored state and the clock, so
 * every screen agrees without the room writing anything: a timer that stops
 * or resets at zero reads as stopped or reset from that instant on, and the
 * next command settles it into that state before it applies.
 */

type SessionTime = { startAt: string; endAt: string };
const clampMs = (value: number) => Math.max(-LIVE_TIMER_MAX_MS, Math.min(LIVE_TIMER_MAX_MS, Math.round(value)));
const iso = (ms: number) => new Date(ms).toISOString();

/** The id of the timer every room starts with, which follows the session on the agenda. */
export const LIVE_SESSION_TIMER_ID = "session";

/** How each kind counts, in the words the add form offers. */
export const LIVE_TIMER_KIND_LABELS: Record<LiveTimer["kind"], string> = {
  session: "Down the session's length",
  until: "Down to a time",
  duration: "Down from a length",
  stopwatch: "Up from zero",
  clock: "Time of day",
};

export const countsUp = (timer: Pick<LiveTimer, "kind">) => timer.kind === "stopwatch";
/** A clock shows the time of day: nothing to start, pause, reset or adjust. */
export const liveTimerCounts = (timer: Pick<LiveTimer, "kind">) => timer.kind !== "clock";

/** A countdown's full length, for its progress and its reset; null for a stopwatch or a span the room does not know. */
export function liveTimerTotalMs(timer: Pick<LiveTimer, "kind" | "durationSeconds">, session: SessionTime) {
  if (timer.kind === "session") return Math.max(0, Date.parse(session.endAt) - Date.parse(session.startAt));
  return timer.kind === "stopwatch" || timer.kind === "clock" || timer.durationSeconds === null
    ? null
    : timer.durationSeconds * 1000;
}

const stopped = (timer: LiveTimer, heldMs: number): LiveTimer => ({
  ...timer,
  followsAgenda: false,
  running: false,
  anchorAt: null,
  heldMs: clampMs(heldMs),
});
const runningTo = (timer: LiveTimer, anchor: number): LiveTimer => ({
  ...timer,
  followsAgenda: false,
  running: true,
  anchorAt: iso(anchor),
  heldMs: 0,
});

/**
 * Reset: back to the full length, stopped. A countdown to a time counts to
 * that time again, and a stopwatch goes back to zero.
 */
function resetLiveTimer(timer: LiveTimer, session: SessionTime): LiveTimer {
  if (timer.kind === "until" && timer.targetAt) return runningTo(timer, Date.parse(timer.targetAt));
  return stopped(timer, liveTimerTotalMs(timer, session) ?? 0);
}

const following = (timer: LiveTimer): LiveTimer => ({
  ...timer,
  followsAgenda: true,
  running: false,
  anchorAt: null,
  heldMs: 0,
});

/** The room's first timer, which follows the session on the agenda. */
export function sessionLiveTimer(): LiveTimer {
  return following({
    id: LIVE_SESSION_TIMER_ID,
    name: "Session",
    kind: "session",
    targetAt: null,
    durationSeconds: null,
    running: false,
    anchorAt: null,
    heldMs: 0,
    followsAgenda: true,
    atZero: DEFAULT_LIVE_TIMER_AT_ZERO,
    sound: DEFAULT_LIVE_TIMER_SOUND,
    change: null,
  });
}

/** A new timer: a session timer follows the agenda, a countdown to a time runs to it, the others wait at their start. */
export function createLiveTimer(id: string, draft: LiveTimerDraft, session: SessionTime, now: number): LiveTimer {
  const durationSeconds =
    draft.kind === "duration"
      ? draft.durationSeconds
      : draft.kind === "until" && draft.targetAt
        ? Math.max(1, Math.min(LIVE_TIMER_MAX_MS / 1000, Math.ceil((Date.parse(draft.targetAt) - now) / 1000)))
        : null;
  const timer: LiveTimer = {
    id,
    name: draft.name,
    kind: draft.kind,
    targetAt: draft.kind === "until" ? draft.targetAt : null,
    durationSeconds,
    running: false,
    anchorAt: null,
    heldMs: 0,
    followsAgenda: false,
    atZero: DEFAULT_LIVE_TIMER_AT_ZERO,
    sound: DEFAULT_LIVE_TIMER_SOUND,
    change: null,
  };
  return draft.kind === "session" ? following(timer) : resetLiveTimer(timer, session);
}

/** A stored timer's own value at `now`, before anything happens at zero. */
function storedValue(timer: LiveTimer, now: number): number {
  if (!timer.running || !timer.anchorAt) return timer.heldMs;
  const anchor = Date.parse(timer.anchorAt);
  return clampMs(countsUp(timer) ? now - anchor : anchor - now);
}

/**
 * The stored state a running countdown has reached by `now` once zero has
 * passed: stopped at zero, or reset to its full length (waiting there, or
 * running its next round). Anything else is returned as it is.
 */
export function settleLiveTimer(timer: LiveTimer, session: SessionTime, now: number): LiveTimer {
  if (timer.followsAgenda || !timer.running || !timer.anchorAt || countsUp(timer)) return timer;
  const zero = Date.parse(timer.anchorAt);
  const { action, resetAfterSeconds, restart } = timer.atZero;
  if (action === "stop") return now >= zero ? stopped(timer, 0) : timer;
  if (action !== "reset") return timer;
  const total = liveTimerTotalMs(timer, session);
  const after = resetAfterSeconds * 1000;
  if (!total || now < zero + after) return timer;
  if (!restart) return stopped(timer, total);
  // Each round runs its full length, then shows `after` over before the next one starts.
  const round = total + after;
  return runningTo(timer, zero + (Math.floor((now - zero - after) / round) + 1) * round);
}

/** What a timer reads at an instant, the same in the room, the studio and on every screen. */
export interface LiveTimerReading {
  /** A countdown's time left (negative once over), or a stopwatch's time counted. */
  valueMs: number;
  /** Whether it is counting; an agenda session timer before its session starts is not. */
  running: boolean;
  /** An agenda session timer before its session starts: the time until it does; null otherwise. */
  startsInMs: number | null;
  /** Whether the reading moves with the clock, so a view showing it must tick. */
  ticking: boolean;
}

export function liveTimerReading(timer: LiveTimer, session: SessionTime, now: number): LiveTimerReading {
  // A clock moves with the time of day and holds no value of its own.
  if (!liveTimerCounts(timer)) return { valueMs: 0, running: false, startsInMs: null, ticking: true };
  if (timer.followsAgenda) {
    const start = Date.parse(session.startAt);
    if (now < start)
      return { valueMs: liveTimerTotalMs(timer, session) ?? 0, running: false, startsInMs: start - now, ticking: true };
    const left = clampMs(Date.parse(session.endAt) - now);
    if (timer.atZero.action === "stop" && left <= 0)
      return { valueMs: 0, running: false, startsInMs: null, ticking: false };
    return { valueMs: left, running: true, startsInMs: null, ticking: true };
  }
  const settled = settleLiveTimer(timer, session, now);
  return { valueMs: storedValue(settled, now), running: settled.running, startsInMs: null, ticking: settled.running };
}

/**
 * The operators' controls. Start counts on from what the timer reads (a
 * session timer waiting for its session starts at its full length); pause
 * holds it; reset goes back to the full length, stopped; follow hands a
 * session timer back to the agenda. Each acts on the settled state, and any
 * of them but follow takes a session timer off the agenda.
 */
export function controlLiveTimer(
  timer: LiveTimer,
  session: SessionTime,
  action: LiveTimerAction,
  now: number,
): LiveTimer {
  if (!liveTimerCounts(timer)) return timer;
  if (action === "reset") return resetLiveTimer(timer, session);
  if (action === "follow") return timer.kind === "session" ? following(timer) : timer;
  const reading = liveTimerReading(timer, session, now);
  if (action === "pause") return stopped(timer, reading.valueMs);
  if (reading.running) return settleLiveTimer(timer, session, now);
  return runningTo(timer, countsUp(timer) ? now - reading.valueMs : now + reading.valueMs);
}

/** Adds or takes time: a countdown gains time left, a stopwatch time counted (never below zero). */
export function adjustLiveTimer(timer: LiveTimer, session: SessionTime, deltaSeconds: number, now: number): LiveTimer {
  if (!liveTimerCounts(timer)) return timer;
  const reading = liveTimerReading(timer, session, now);
  const value = reading.valueMs + deltaSeconds * 1000;
  const next = clampMs(countsUp(timer) ? Math.max(0, value) : value);
  if (!reading.running) return stopped(timer, next);
  return runningTo(timer, countsUp(timer) ? now - next : now + next);
}

/** Changes what a timer does at zero and its sounds; null when the timer cannot have them. */
export function configureLiveTimer(
  timer: LiveTimer,
  session: SessionTime,
  settings: LiveTimerSettings,
  now: number,
): LiveTimer | null {
  if (!liveTimerHasSettings(timer)) return null;
  if (settings.atZero.action === "reset" && !liveTimerResetsAtZero(timer.kind)) return null;
  // Whatever the old settings did by now stays done; the new ones apply from here.
  return { ...settleLiveTimer(timer, session, now), atZero: settings.atZero, sound: settings.sound };
}

/** A stopwatch and a clock never reach zero, so they have nothing to do there and no sound to play. */
export const liveTimerHasSettings = (timer: Pick<LiveTimer, "kind">) => !countsUp(timer) && liveTimerCounts(timer);

// ── Sounds ──────────────────────────────────────────────────────────────────

export type LiveTimerCue = "warning" | "zero";

/** The instant the countdown reaches zero, as it stands at `at`; null while it is paused. */
function zeroInstant(timer: LiveTimer, session: SessionTime, at: number): number | null {
  if (timer.followsAgenda) return Date.parse(session.endAt);
  const settled = settleLiveTimer(timer, session, at);
  return settled.running && settled.anchorAt ? Date.parse(settled.anchorAt) : null;
}

/**
 * The sound a timer's countdown asks for between two instants (after `from`,
 * up to and including `to`): the buzzer when it reached zero, else the chime
 * when it reached its warning. Only time running down sounds; an operator's
 * jump past either point does not.
 */
export function liveTimerCue(timer: LiveTimer, session: SessionTime, from: number, to: number): LiveTimerCue | null {
  if (!liveTimerHasSettings(timer) || to <= from) return null;
  const zero = zeroInstant(timer, session, from);
  if (zero === null) return null;
  const crossed = (instant: number) => from < instant && instant <= to;
  if (crossed(zero)) return timer.sound.zero ? "zero" : null;
  const { warningSeconds } = timer.sound;
  if (warningSeconds === null) return null;
  const warning = zero - warningSeconds * 1000;
  // An agenda session timer warns only once its session is under way.
  if (timer.followsAgenda && warning < Date.parse(session.startAt)) return null;
  return crossed(warning) ? "warning" : null;
}

// ── The graphic ─────────────────────────────────────────────────────────────

/**
 * What the graphic shows: time left or gone, by its own choice; a stopwatch
 * always counts up. Before an agenda session starts, the time until it does.
 */
export function liveTimerShownMs(
  timer: LiveTimer,
  graphic: Pick<LiveTimerGraphic, "direction">,
  session: SessionTime,
  now: number,
) {
  const reading = liveTimerReading(timer, session, now);
  if (reading.startsInMs !== null) return reading.startsInMs;
  if (countsUp(timer) || graphic.direction === "remaining") return reading.valueMs;
  const total = liveTimerTotalMs(timer, session);
  return total === null ? reading.valueMs : Math.max(0, total - reading.valueMs);
}

/** "warn" within the warning time, "over" once past zero by the overrun allowance; a stopwatch or a clock never warns. */
export function liveTimerTone(
  timer: Pick<LiveTimer, "kind">,
  remainingMs: number,
  thresholds: Pick<LiveTimerGraphic, "warningSeconds" | "overrunSeconds">,
): "warn" | "over" | undefined {
  if (!liveTimerHasSettings(timer)) return undefined;
  if (remainingMs < 0 && -remainingMs >= thresholds.overrunSeconds * 1000) return "over";
  return remainingMs <= thresholds.warningSeconds * 1000 ? "warn" : undefined;
}

const SIZE_FACTOR: Record<LiveTimerGraphic["size"], number> = { small: 0.5, medium: 0.75, large: 1 };
const PLACEMENT: Record<
  Exclude<LiveTimerGraphic["placement"], "layout">,
  Pick<LiveOverlayElementPlacement, "horizontal" | "vertical">
> = {
  "top-left": { horizontal: "left", vertical: "top" },
  "top-right": { horizontal: "right", vertical: "top" },
  "bottom-left": { horizontal: "left", vertical: "bottom" },
  "bottom-right": { horizontal: "right", vertical: "bottom" },
  center: { horizontal: "center", vertical: "middle" },
};

/**
 * Where the graphic sits on a source: the layout's timer box at the graphic's
 * size, or, when the graphic names its own position, that corner of the
 * title-safe area. Whether it shows stays the layout's choice.
 */
export function liveTimerLayout(
  graphic: Pick<LiveTimerGraphic, "placement" | "size">,
  timer: LiveOverlayElementPlacement,
): LiveOverlayElementPlacement {
  const sized = scaleOverlayBox(timer, SIZE_FACTOR[graphic.size]);
  return graphic.placement === "layout" ? sized : anchorOverlayBox(sized, PLACEMENT[graphic.placement]);
}

/** Changes one timer's graphic while preserving every other timer and its position. */
export function updateLiveTimerGraphics(
  current: readonly LiveTimerGraphic[],
  graphic: LiveTimerGraphic,
  visible: boolean,
): LiveTimerGraphic[] {
  if (!visible) return withoutLiveTimerGraphic(current, graphic.timerId);
  return current.some((entry) => entry.timerId === graphic.timerId)
    ? current.map((entry) => (entry.timerId === graphic.timerId ? graphic : entry))
    : [...current, graphic];
}
export function withoutLiveTimerGraphic(current: readonly LiveTimerGraphic[], timerId: string): LiveTimerGraphic[] {
  return current.filter((graphic) => graphic.timerId !== timerId);
}
