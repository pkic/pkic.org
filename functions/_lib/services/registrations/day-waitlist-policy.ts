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
 * holder would be offered the next seat again. Adding each entry's old
 * position to the day's highest position keeps lapsed entries distinct and in
 * their original order behind everyone already waiting. Materializing the tails
 * prevents earlier updates in the same statement from changing that order.
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
       )
       UPDATE event_day_waitlist_entries AS w
       SET status = 'waiting', priority_lane = 'general', offer_expires_at = NULL,
           reason_code = '${LAPSED_OFFER_REASON_CODE}', updated_at = ?,
           position = w.position + (
             SELECT queue.position FROM queue_tails queue
             WHERE queue.event_day_id = w.event_day_id
           )
       WHERE w.status = 'offered' AND w.offer_expires_at IS NOT NULL AND w.offer_expires_at <= ?
         ${eventId ? "AND w.event_id = ?" : ""}`,
    )
    .bind(...(eventId ? [eventId] : []), now, now, ...(eventId ? [eventId] : []));
}
