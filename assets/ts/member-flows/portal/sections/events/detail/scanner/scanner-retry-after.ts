/** Bound Retry-After from scan and roster responses to one day. */
export function scannerRetryAfterMs(headers: Headers, now = Date.now()): number | null {
  const value = headers.get("retry-after");
  if (!value) return null;
  const seconds = Number(value);
  const wait = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - now;
  return Number.isFinite(wait) ? Math.max(0, Math.min(86_400_000, wait)) : null;
}
