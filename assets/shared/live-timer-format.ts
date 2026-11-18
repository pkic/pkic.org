import { formatNumber } from "./format-number";
import { renderOverlayTextMarkdown } from "./overlay-text-template";
import type { LiveTimerGraphic } from "./schemas/live-session-timer";

/**
 * How every timer reads, in the studio and on every screen alike. A
 * countdown shows whole seconds rounded up, so it reads 0:01 until it is
 * over; time over reads with a leading `+`.
 */

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
/** A fixed 365-day year, as the custom duration template counts it. */
const YEAR = 365 * DAY;

const pad = (value: number) => String(value).padStart(2, "0");
const wholeSeconds = (milliseconds: number) => Math.ceil(Math.abs(milliseconds) / 1000);

/**
 * The one clock format: "4:05" under an hour, "1:02:03" under a day,
 * "3d 4h 12m" (days, hours and minutes, each with its unit, so it never
 * reads as a clock) under a year, and "2y 145d"
 * beyond, for a countdown that runs for years. Time over reads "+4:05".
 */
export function formatLiveDuration(milliseconds: number): string {
  const sign = milliseconds < 0 ? "+" : "";
  const total = wholeSeconds(milliseconds);
  if (total < HOUR) return `${sign}${Math.floor(total / MINUTE)}:${pad(total % MINUTE)}`;
  if (total < DAY)
    return `${sign}${Math.floor(total / HOUR)}:${pad(Math.floor(total / MINUTE) % 60)}:${pad(total % MINUTE)}`;
  if (total < YEAR) {
    // Past a day the seconds drop away; the minutes round up as the seconds did.
    const minutes = Math.ceil(total / MINUTE);
    const days = Math.floor(minutes / (24 * 60));
    return `${sign}${formatNumber(days)}d ${Math.floor(minutes / 60) % 24}h ${minutes % 60}m`;
  }
  const days = Math.ceil(total / DAY);
  return `${sign}${formatNumber(Math.floor(days / 365))}y ${formatNumber(days % 365)}d`;
}

/**
 * The clock format at its most compact, for a timer that shares the screen:
 * as `formatLiveDuration`, but from an hour on it reads hours and minutes
 * ("1h 05m"), so the time takes no more room than it needs.
 */
export function formatLiveDurationCompact(milliseconds: number): string {
  const total = wholeSeconds(milliseconds);
  if (total < HOUR || total >= DAY) return formatLiveDuration(milliseconds);
  const sign = milliseconds < 0 ? "+" : "";
  const minutes = Math.ceil(total / MINUTE);
  return `${sign}${Math.floor(minutes / 60)}h ${pad(minutes % 60)}m`;
}

/** Below this, the mark reads whole seconds alone: two digits fit inside it. */
export const LIVE_TIMER_MARK_SECONDS = 100;

/** What the mark reads in its center: whole seconds while they fit ("42", "+5"), then the clock, then hours and minutes. */
export function formatLiveTimerMark(milliseconds: number): string {
  const total = wholeSeconds(milliseconds);
  if (total >= HOUR) return formatLiveDurationCompact(milliseconds);
  if (total >= LIVE_TIMER_MARK_SECONDS) return formatLiveDuration(milliseconds);
  return `${milliseconds < 0 ? "+" : ""}${total}`;
}

/** A timer graphic's text in its own format: the clock, total seconds, or the operators' template. */
export function formatLiveTimer(
  milliseconds: number,
  format: LiveTimerGraphic["format"],
  customFormat = "{{hours}}h {{minutes}}m {{seconds}}s",
): string {
  if (format === "clock") return formatLiveDuration(milliseconds);
  const sign = milliseconds < 0 ? "+" : "";
  const total = wholeSeconds(milliseconds);
  if (format === "ss") return `${sign}${formatNumber(total)}`;
  let remainder = total;
  const units: Record<string, number> = {};
  for (const [name, secondsPerUnit] of [
    ["years", YEAR],
    ["months", 30 * DAY],
    ["days", DAY],
    ["hours", HOUR],
    ["minutes", MINUTE],
    ["seconds", 1],
  ] as const) {
    units[name] = Math.floor(remainder / secondsPerUnit);
    remainder %= secondsPerUnit;
  }
  return sign + renderOverlayTextMarkdown(customFormat, units);
}
