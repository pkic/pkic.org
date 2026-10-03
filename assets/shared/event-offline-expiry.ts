import { instantToDateTimeLocal } from "./timezone";

/** Never let event-wide eligibility survive a change of the event's calendar day. */
export function offlineEligibilityExpiresAt(serverNow: string, timeZone: string): string {
  const start = Date.parse(serverNow);
  const day = instantToDateTimeLocal(serverNow, timeZone).slice(0, 10);
  let low = start;
  let high = start + 15 * 60_000;
  if (instantToDateTimeLocal(new Date(high), timeZone).slice(0, 10) === day) return new Date(high).toISOString();
  // Search actual instants rather than assuming every local midnight exists during DST changes.
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (instantToDateTimeLocal(new Date(middle), timeZone).slice(0, 10) === day) low = middle;
    else high = middle;
  }
  return new Date(high).toISOString();
}
