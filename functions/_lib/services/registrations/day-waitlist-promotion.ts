import { all, first, run } from "../../db/queries";
import type { DatabaseLike } from "../../types";
import { addHours, nowIso } from "../../utils/time";
import { countActiveOffersForDay, countConfirmedInPersonForDay } from "./day-waitlist-capacity";
import type { DayWaitlistRow } from "./day-waitlist-types";

export async function expireDayWaitlistOffers(db: DatabaseLike, eventId: string): Promise<void> {
  const now = nowIso();
  await run(
    db,
    `UPDATE event_day_waitlist_entries
     SET status = 'expired', updated_at = ?
     WHERE event_id = ? AND status = 'offered'
       AND offer_expires_at IS NOT NULL AND offer_expires_at <= ?`,
    [now, eventId, now],
  );
}

async function userHasActiveOffer(db: DatabaseLike, eventId: string, userId: string): Promise<boolean> {
  const row = await first<{ total: number }>(
    db,
    `SELECT COUNT(*) AS total
     FROM event_day_waitlist_entries
     WHERE event_id = ? AND user_id = ? AND status = 'offered'
       AND (offer_expires_at IS NULL OR offer_expires_at > ?)`,
    [eventId, userId, nowIso()],
  );
  return Number(row?.total ?? 0) > 0;
}

export async function promoteDayWaitlistIfCapacity(
  db: DatabaseLike,
  payload: { eventId: string; eventDayId: string; claimWindowHours: number },
): Promise<DayWaitlistRow | null> {
  await expireDayWaitlistOffers(db, payload.eventId);
  const day = await first<{ in_person_capacity: number | null }>(
    db,
    "SELECT in_person_capacity FROM event_days WHERE id = ? AND event_id = ?",
    [payload.eventDayId, payload.eventId],
  );
  if (!day?.in_person_capacity || day.in_person_capacity <= 0) return null;

  const confirmed = await countConfirmedInPersonForDay(db, payload.eventDayId);
  const reserved = confirmed + (await countActiveOffersForDay(db, payload.eventDayId));
  if (reserved >= day.in_person_capacity) return null;

  const candidates = await all<DayWaitlistRow>(
    db,
    `SELECT w.id, w.event_id, w.event_day_id, w.registration_id, w.user_id,
            w.priority_lane, w.status, w.position, w.offer_expires_at
     FROM event_day_waitlist_entries w
     JOIN registrations r ON r.id = w.registration_id
     WHERE w.event_id = ? AND w.event_day_id = ? AND w.status = 'waiting'
       AND r.status IN ('pending_email_confirmation', 'registered')
     ORDER BY CASE w.priority_lane WHEN 'continuity' THEN 1 ELSE 2 END ASC, w.position ASC`,
    [payload.eventId, payload.eventDayId],
  );

  for (const candidate of candidates) {
    if (await userHasActiveOffer(db, payload.eventId, candidate.user_id)) continue;
    const now = nowIso();
    const offerExpiresAt = addHours(now, payload.claimWindowHours);
    const updated = await run(
      db,
      `UPDATE event_day_waitlist_entries
       SET status = 'offered', offer_expires_at = ?, updated_at = ?
       WHERE id = ? AND status = 'waiting'
         AND (
           (
             SELECT COUNT(*)
             FROM registration_day_attendance rda
             JOIN registrations r ON r.id = rda.registration_id
             LEFT JOIN event_day_waitlist_entries w
               ON w.event_day_id = rda.event_day_id
              AND w.registration_id = rda.registration_id
              AND w.status IN ('waiting', 'offered')
             WHERE rda.event_day_id = ? AND rda.attendance_type = 'in_person'
               AND r.status IN ('pending_email_confirmation', 'registered')
               AND r.capacity_exempt_in_person = 0 AND w.id IS NULL
           ) + (
             SELECT COUNT(*)
             FROM event_day_waitlist_entries w
             JOIN registrations r ON r.id = w.registration_id
             WHERE w.event_day_id = ? AND w.status = 'offered'
               AND (w.offer_expires_at IS NULL OR w.offer_expires_at > ?)
               AND r.status IN ('pending_email_confirmation', 'registered')
               AND r.capacity_exempt_in_person = 0
           )
         ) < ?`,
      [offerExpiresAt, now, candidate.id, payload.eventDayId, payload.eventDayId, now, day.in_person_capacity],
    );
    if (updated.changes === 0) continue;
    return { ...candidate, status: "offered", offer_expires_at: offerExpiresAt };
  }
  return null;
}
