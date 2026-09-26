export const ADMIN_DAY_CAPACITY_EXEMPT_REASON_CODE = "admin_capacity_exempt";

/**
 * Rows matching this predicate do not consume ordinary day capacity. Waiting
 * and offered rows have no seat yet; an accepted admin override deliberately
 * admits only that day beyond capacity.
 */
export const NON_CAPACITY_CONSUMING_DAY_WAITLIST_SQL = `(w.status IN ('waiting', 'offered') OR (w.status = 'accepted' AND w.reason_code = '${ADMIN_DAY_CAPACITY_EXEMPT_REASON_CODE}'))`;
