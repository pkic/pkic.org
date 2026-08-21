export const DEFAULT_MEMBER_SESSION_TTL_HOURS = 720;

/**
 * Environment configuration is untrusted text. Accept only a complete,
 * positive integer so values such as `12junk`, fractions, infinities, and
 * unsafe integers cannot silently alter session lifetime policy.
 */
export function resolveMemberSessionTtlHours(configuredValue: string | undefined): number {
  const parsed = Number(configuredValue);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : DEFAULT_MEMBER_SESSION_TTL_HOURS;
}
