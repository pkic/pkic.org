import { instantToDateTimeLocal } from "./timezone";

/** Covers the longest local calendar day, including a daylight-saving fallback. */
export const SCANNER_OFFLINE_MAXIMUM_MS = 26 * 60 * 60_000;
export const SCANNER_EVENT_OFFLINE_MAXIMUM_MS = 32 * 24 * 60 * 60_000;
export const SCANNER_ELIGIBILITY_REFRESH_MS = 2 * 60_000;

interface EventOfflineWindow {
  startsAt: string | null;
  endsAt: string | null;
}

/** Event preparation lasts through the calendar day following the event, independently of refresh timing. */
export function offlineEligibilityExpiresAt(
  serverNow: string,
  timeZone: string,
  window: EventOfflineWindow | number = SCANNER_OFFLINE_MAXIMUM_MS,
): string {
  if (typeof window !== "number") {
    const start = Date.parse(serverNow);
    const end = window.endsAt ?? window.startsAt;
    if (!end) return new Date(start + 48 * 60 * 60_000).toISOString();
    const endDate = new Date(`${instantToDateTimeLocal(end, timeZone).slice(0, 10)}T00:00:00.000Z`);
    endDate.setUTCDate(endDate.getUTCDate() + 2);
    const endDay = endDate.toISOString().slice(0, 10);
    if (window.startsAt) {
      const startDate = new Date(`${instantToDateTimeLocal(window.startsAt, timeZone).slice(0, 10)}T00:00:00.000Z`);
      startDate.setUTCDate(startDate.getUTCDate() - 1);
      if (instantToDateTimeLocal(serverNow, timeZone).slice(0, 10) < startDate.toISOString().slice(0, 10))
        return serverNow;
    }
    let low = start;
    let high = Math.min(Date.parse(end) + 3 * 24 * 60 * 60_000, start + SCANNER_EVENT_OFFLINE_MAXIMUM_MS);
    if (instantToDateTimeLocal(serverNow, timeZone).slice(0, 10) >= endDay) return serverNow;
    if (instantToDateTimeLocal(new Date(high), timeZone).slice(0, 10) < endDay) return new Date(high).toISOString();
    while (high - low > 1) {
      const middle = Math.floor((low + high) / 2);
      if (instantToDateTimeLocal(new Date(middle), timeZone).slice(0, 10) < endDay) low = middle;
      else high = middle;
    }
    return new Date(high).toISOString();
  }
  const maximumMs = window;
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
