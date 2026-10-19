import { renderOverlayTextMarkdown } from "./overlay-text-template";
import { anchorOverlayBox, scaleOverlayBox } from "./live-overlay-geometry";
import type { LiveOverlayElementPlacement } from "./schemas/live-overlay-layout";
import {
  LIVE_TIMER_MAX_MS,
  type LiveTimer,
  type LiveTimerDraft,
  type LiveTimerGraphic,
} from "./schemas/live-session-timer";

/**
 * How a room's timers count, for the room and every browser alike. A
 * countdown runs to an anchor instant and holds its time left while paused;
 * a stopwatch runs from an anchor and holds its time counted.
 */

type SessionTime = { startAt: string; endAt: string };
const clampMs = (value: number) => Math.max(-LIVE_TIMER_MAX_MS, Math.min(LIVE_TIMER_MAX_MS, Math.round(value)));
const iso = (ms: number) => new Date(ms).toISOString();

/** The id of the timer every room starts with, which follows the session on the agenda. */
export const LIVE_SESSION_TIMER_ID = "session";

/** How each kind counts, in the words the add form offers. */
export const LIVE_TIMER_KIND_LABELS: Record<LiveTimer["kind"], string> = {
  session: "Down to the session's end",
  until: "Down to a time",
  duration: "Down from a length",
  stopwatch: "Up from zero",
};

export const countsUp = (timer: Pick<LiveTimer, "kind">) => timer.kind === "stopwatch";

/** Where a countdown resets to: the agenda's end, the chosen time, or its full length. */
function resetTarget(timer: Pick<LiveTimer, "kind" | "targetAt">, session: SessionTime): string | null {
  if (timer.kind === "session") return session.endAt;
  if (timer.kind === "until") return timer.targetAt;
  return null;
}

/** A timer as it starts or resets: clock-bound countdowns run at once, the others wait to be started. */
function resetLiveTimer(timer: LiveTimer, session: SessionTime): LiveTimer {
  const target = resetTarget(timer, session);
  if (target) return { ...timer, running: true, anchorAt: target, heldMs: 0 };
  return { ...timer, running: false, anchorAt: null, heldMs: (timer.durationSeconds ?? 0) * 1000 };
}

/** The room's first timer, which counts down to the session's scheduled end. */
export function sessionLiveTimer(session: SessionTime): LiveTimer {
  return resetLiveTimer(
    {
      id: LIVE_SESSION_TIMER_ID,
      name: "Session",
      kind: "session",
      targetAt: null,
      durationSeconds: null,
      running: false,
      anchorAt: null,
      heldMs: 0,
      change: null,
    },
    session,
  );
}

export function createLiveTimer(id: string, draft: LiveTimerDraft, session: SessionTime, now: number): LiveTimer {
  const durationSeconds =
    draft.kind === "duration"
      ? draft.durationSeconds
      : draft.kind === "until" && draft.targetAt
        ? Math.max(1, Math.min(LIVE_TIMER_MAX_MS / 1000, Math.ceil((Date.parse(draft.targetAt) - now) / 1000)))
        : null;
  return resetLiveTimer(
    {
      id,
      name: draft.name,
      kind: draft.kind,
      targetAt: draft.kind === "until" ? draft.targetAt : null,
      durationSeconds,
      running: false,
      anchorAt: null,
      heldMs: 0,
      change: null,
    },
    session,
  );
}

/** A countdown's time left at `now` (negative once over), or a stopwatch's time counted. */
export function liveTimerValue(
  timer: Pick<LiveTimer, "kind" | "running" | "anchorAt" | "heldMs">,
  now: number,
): number {
  if (!timer.running || !timer.anchorAt) return timer.heldMs;
  const anchor = Date.parse(timer.anchorAt);
  return clampMs(countsUp(timer) ? now - anchor : anchor - now);
}

/** A countdown's full length, for its progress; null for a stopwatch or a span the room does not know. */
export function liveTimerTotalMs(timer: LiveTimer, session: SessionTime): number | null {
  if (timer.kind === "session") return Date.parse(session.endAt) - Date.parse(session.startAt);
  return timer.kind === "stopwatch" || timer.durationSeconds === null ? null : timer.durationSeconds * 1000;
}

export function controlLiveTimer(
  timer: LiveTimer,
  session: SessionTime,
  action: "start" | "pause" | "reset",
  now: number,
): LiveTimer {
  if (action === "reset") return resetLiveTimer(timer, session);
  const value = liveTimerValue(timer, now);
  if (action === "pause") return { ...timer, running: false, anchorAt: null, heldMs: value };
  if (timer.running) return timer;
  return { ...timer, running: true, anchorAt: iso(countsUp(timer) ? now - value : now + value), heldMs: 0 };
}

/** Adds or takes time: a countdown gains time left, a stopwatch time counted (never below zero). */
export function adjustLiveTimer(timer: LiveTimer, deltaSeconds: number, now: number): LiveTimer {
  const value = liveTimerValue(timer, now) + deltaSeconds * 1000;
  const next = countsUp(timer) ? Math.max(0, value) : clampMs(value);
  if (!timer.running) return { ...timer, heldMs: clampMs(next) };
  return { ...timer, anchorAt: iso(countsUp(timer) ? now - next : now + next) };
}

// ── The graphic ─────────────────────────────────────────────────────────────

/** What the graphic shows: time left or gone, by its own choice; a stopwatch always counts up. */
export function liveTimerShownMs(
  timer: LiveTimer,
  graphic: Pick<LiveTimerGraphic, "direction">,
  session: SessionTime,
  now: number,
) {
  const value = liveTimerValue(timer, now);
  if (countsUp(timer) || graphic.direction === "remaining") return value;
  const total = liveTimerTotalMs(timer, session);
  return total === null ? value : Math.max(0, total - value);
}

/** Numeric or templated duration, with a leading `+` once a countdown is over time. */
export function formatLiveTimer(
  milliseconds: number,
  format: LiveTimerGraphic["format"],
  customFormat = "{{hours}}h {{minutes}}m {{seconds}}s",
): string {
  const over = milliseconds < 0;
  const total = Math.ceil(Math.abs(milliseconds) / 1000);
  const seconds = String(total % 60).padStart(2, "0");
  const sign = over ? "+" : "";
  if (format === "ss") return `${sign}${total}`;
  if (format === "custom") {
    let remainder = total;
    const units: Record<string, number> = {};
    for (const [name, secondsPerUnit] of [
      ["years", 31536000],
      ["months", 2592000],
      ["days", 86400],
      ["hours", 3600],
      ["minutes", 60],
      ["seconds", 1],
    ] as const) {
      units[name] = Math.floor(remainder / secondsPerUnit);
      remainder %= secondsPerUnit;
    }
    return sign + renderOverlayTextMarkdown(customFormat, units);
  }
  if (format === "hh:mm:ss")
    return `${sign}${String(Math.floor(total / 3600)).padStart(2, "0")}:${String(Math.floor(total / 60) % 60).padStart(2, "0")}:${seconds}`;
  return `${sign}${String(Math.floor(total / 60)).padStart(2, "0")}:${seconds}`;
}

/** "warn" within the warning time, "over" once past zero by the overrun allowance; a stopwatch never warns. */
export function liveTimerTone(
  timer: Pick<LiveTimer, "kind">,
  remainingMs: number,
  thresholds: Pick<LiveTimerGraphic, "warningSeconds" | "overrunSeconds">,
): "warn" | "over" | undefined {
  if (countsUp(timer)) return undefined;
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
