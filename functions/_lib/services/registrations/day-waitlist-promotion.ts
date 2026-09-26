import { all, first, run } from "../../db/queries";
import type { DatabaseLike, StatementLike } from "../../types";
import { addHours, nowIso } from "../../utils/time";
import {
  countActiveOffersForDay,
  countConfirmedInPersonForDay,
  eventDayHasAvailableCapacitySql,
} from "./day-waitlist-capacity";
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

export async function promoteDayWaitlistIfCapacity(
  db: DatabaseLike,
  payload: {
    eventId: string;
    eventDayId: string;
    claimWindowHours: number;
    prepareCommitGuard?: (promotion: DayWaitlistRow) => StatementLike;
    prepareCommitStatements?: (promotion: DayWaitlistRow) => Promise<StatementLike[]>;
    isCommitConflict?: (error: unknown) => boolean;
  },
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
       AND r.capacity_exempt_in_person = 0
     ORDER BY CASE w.priority_lane WHEN 'continuity' THEN 1 ELSE 2 END ASC, w.position ASC`,
    [payload.eventId, payload.eventDayId],
  );

  for (const candidate of candidates) {
    const now = nowIso();
    const offerExpiresAt = addHours(now, payload.claimWindowHours);
    const availableCapacitySql = eventDayHasAvailableCapacitySql("ed", "?");
    const updateStatement = db
      .prepare(
        `UPDATE event_day_waitlist_entries
       SET status = 'offered', offer_expires_at = ?, updated_at = ?
       WHERE id = ? AND status = 'waiting'
         AND EXISTS (
           SELECT 1
           FROM event_days ed
           WHERE ed.id = ? AND ed.event_id = ?
             AND ${availableCapacitySql}
         )`,
      )
      .bind(offerExpiresAt, now, candidate.id, payload.eventDayId, payload.eventId, now);
    const promotion = { ...candidate, status: "offered" as const, offer_expires_at: offerExpiresAt };
    const commitGuard = payload.prepareCommitGuard?.(promotion);
    const additionalStatements = (await payload.prepareCommitStatements?.(promotion)) ?? [];
    try {
      const [updated] = await db.batch([
        updateStatement,
        ...(commitGuard ? [commitGuard] : []),
        ...additionalStatements,
      ]);
      if ((updated.meta?.changes ?? 0) === 0) continue;
      return promotion;
    } catch (error) {
      if (payload.isCommitConflict?.(error) === true) continue;
      throw error;
    }
  }
  return null;
}
