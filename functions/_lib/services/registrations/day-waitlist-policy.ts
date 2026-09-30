export const ADMIN_DAY_CAPACITY_EXEMPT_REASON_CODE = "admin_capacity_exempt";

/** Waiting and offered attendees do not yet have a physical seat. */
export const NON_CAPACITY_CONSUMING_DAY_WAITLIST_SQL = "w.status IN ('waiting', 'offered')";
