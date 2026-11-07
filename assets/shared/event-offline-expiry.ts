import { instantToDateTimeLocal } from "./timezone";

/** Covers the longest local calendar day, including a daylight-saving fallback. */
export const SCANNER_OFFLINE_MAXIMUM_MS = 26 * 60 * 60_000;
export const SCANNER_ELIGIBILITY_REFRESH_MS = 2 * 60_000;

/** Never let event-wide eligibility survive a change of the event's calendar day. */
export function offlineEligibilityExpiresAt(
  serverNow: string,
  timeZone: string,
  maximumMs = SCANNER_OFFLINE_MAXIMUM_MS,
): string {
  const start = Date.parse(serverNow);
  const day = instantToDateTimeLocal(serverNow, timeZone).slice(0, 10);
  let low = start;
  let high = start + maximumMs;
  if (instantToDateTimeLocal(new Date(high), timeZone).slice(0, 10) === day) return new Date(high).toISOString();
  // Search actual instants rather than assuming every local midnight exists during DST changes.
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (instantToDateTimeLocal(new Date(middle), timeZone).slice(0, 10) === day) low = middle;
    else high = middle;
  }
  return new Date(high).toISOString();
}
