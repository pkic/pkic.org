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
 * "3d 04:12" (days, hours and minutes) under a year, and "2y 145d"
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
    return `${sign}${formatNumber(days)}d ${pad(Math.floor(minutes / 60) % 24)}:${pad(minutes % 60)}`;
  }
  const days = Math.ceil(total / DAY);
  return `${sign}${formatNumber(Math.floor(days / 365))}y ${formatNumber(days % 365)}d`;
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

/**
 * A countdown's length as an operator types it: `h:mm:ss`, `m:ss`, or a
 * whole number of minutes. Null when it does not read as a length.
 */
export function parseLiveTimerLength(text: string): number | null {
  const value = text.trim();
  if (/^\d+$/u.test(value)) return Number(value) * 60;
  const parts = /^(?:(\d+):)?(\d{1,2}):(\d{2})$/u.exec(value);
  if (!parts) return null;
  const [, hours = "0", minutes, seconds] = parts;
  if (Number(seconds) > 59 || (parts[1] !== undefined && Number(minutes) > 59)) return null;
  return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds);
}

/** A countdown's length as the operator types it back: `m:ss`, or `h:mm:ss` from an hour. */
export function formatLiveTimerLength(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds / 60) % 60;
  const rest = String(seconds % 60).padStart(2, "0");
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${Math.floor(seconds / 60)}:${rest}`;
}
