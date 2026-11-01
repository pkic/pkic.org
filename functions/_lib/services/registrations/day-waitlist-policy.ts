export const ADMIN_DAY_CAPACITY_EXEMPT_REASON_CODE = "admin_capacity_exempt";

/** Waiting, offered, and expired invitations do not grant participation. */
export const NON_CAPACITY_CONSUMING_DAY_WAITLIST_SQL = "w.status IN ('waiting', 'offered', 'expired')";

/** Resolve an expired offer even before a background promotion records the transition. */
export function dayWaitlistStatusSql(alias: string): string {
  return `CASE WHEN ${alias}.status = 'offered' AND ${alias}.offer_expires_at IS NOT NULL
    AND ${alias}.offer_expires_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now') THEN 'expired' ELSE ${alias}.status END`;
}
