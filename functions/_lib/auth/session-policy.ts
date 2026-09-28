export const DEFAULT_MEMBER_SESSION_TTL_HOURS = 720;
export const DEFAULT_USER_SESSION_IDLE_TTL_HOURS = 24 * 7;
export const STAFF_SESSION_IDLE_TTL_HOURS = 1;

const HOUR_MS = 60 * 60 * 1000;

/** The inactivity deadline can never extend the session's absolute lifetime. */
export function sessionIdleExpiresAt(
  lastActivityAtSeconds: number,
  absoluteExpiresAt: string,
  idleTtlHours: number,
): string {
  const idleExpiry = new Date(lastActivityAtSeconds * 1000 + idleTtlHours * HOUR_MS);
  const absoluteExpiry = new Date(absoluteExpiresAt);
  return (idleExpiry < absoluteExpiry ? idleExpiry : absoluteExpiry).toISOString();
}

/**
 * Environment configuration is untrusted text. Accept only a complete,
 * positive integer so values such as `12junk`, fractions, infinities, and
 * unsafe integers cannot silently alter session lifetime policy.
 */
export function resolveMemberSessionTtlHours(configuredValue: string | undefined): number {
  const parsed = Number(configuredValue);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : DEFAULT_MEMBER_SESSION_TTL_HOURS;
}
