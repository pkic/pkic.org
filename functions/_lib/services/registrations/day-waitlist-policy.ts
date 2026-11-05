import type { DatabaseLike, StatementLike } from "../../types";

export const ADMIN_DAY_CAPACITY_EXEMPT_REASON_CODE = "admin_capacity_exempt";

/** Waiting, offered, and expired invitations do not grant participation. */
export const NON_CAPACITY_CONSUMING_DAY_WAITLIST_SQL = "w.status IN ('waiting', 'offered', 'expired')";

/** Resolve an expired offer even before a background promotion records the transition. */
export function dayWaitlistStatusSql(alias: string): string {
  return `CASE WHEN ${alias}.status = 'offered' AND ${alias}.offer_expires_at IS NOT NULL
    AND ${alias}.offer_expires_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now') THEN 'expired' ELSE ${alias}.status END`;
}

/** Why an entry is waiting again after an offer its holder did not claim in time. */
export const LAPSED_OFFER_REASON_CODE = "offer_lapsed";

/**
 * An offer nobody claimed in time sends its holder to the back of that day's
 * queue. The seat is free for the next person, and the holder keeps waiting for
 * a later one instead of silently holding the seat they never claimed.
 *
 * The back of the queue is behind every lane: promotion takes the continuity
 * lane first, so a lapsed continuity offer moves to the general lane, or its
 * holder would be offered the next seat again. Append consecutive ordinals to
 * the frozen queue tail, preserving order without multiplying positions on
 * repeated lapses. Materializing both snapshots prevents update-order effects.
 */
export function prepareLapsedDayOfferRequeue(
  db: DatabaseLike,
  { now, eventId }: { now: string; eventId?: string },
): StatementLike {
  return db
    .prepare(
      `WITH queue_tails AS MATERIALIZED (
         SELECT event_day_id, MAX(position) AS position FROM event_day_waitlist_entries
         ${eventId ? "WHERE event_id = ?" : ""}
         GROUP BY event_day_id
       ), lapsed_entries AS MATERIALIZED (
         SELECT id, event_day_id,
           ROW_NUMBER() OVER (PARTITION BY event_day_id ORDER BY position, id) AS ordinal
         FROM event_day_waitlist_entries
         WHERE status = 'offered' AND offer_expires_at IS NOT NULL AND offer_expires_at <= ?
           ${eventId ? "AND event_id = ?" : ""}
       )
       UPDATE event_day_waitlist_entries AS w
       SET status = 'waiting', priority_lane = 'general', offer_expires_at = NULL,
           reason_code = '${LAPSED_OFFER_REASON_CODE}', updated_at = ?,
           position = (SELECT queue.position FROM queue_tails queue WHERE queue.event_day_id = w.event_day_id)
             + (SELECT lapsed.ordinal FROM lapsed_entries lapsed WHERE lapsed.id = w.id)
       WHERE w.id IN (SELECT id FROM lapsed_entries)`,
    )
    .bind(...(eventId ? [eventId] : []), now, ...(eventId ? [eventId] : []), now);
}
