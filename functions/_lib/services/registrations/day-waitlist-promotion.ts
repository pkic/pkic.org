import { eventDayOptionAccessSql } from "../event-participation/session-access";
import { all } from "../../db/queries";
import type { DatabaseLike, StatementLike } from "../../types";
import { addHours, nowIso } from "../../utils/time";
import {
  eventAttendanceOptionCapacitySql,
  eventAttendanceOptionOccupiedSql,
  eventAttendanceOptionHasAvailableCapacitySql,
  ROLE_BASED_CAPACITY_EXEMPT_ROLE_SQL,
} from "./day-waitlist-capacity";
import type { DayWaitlistRow } from "./day-waitlist-types";
import { prepareLapsedDayOfferRequeue } from "./day-waitlist-policy";
import { prioritizeWorkAddresses } from "../../email-domains/contact-kind";
import { parseVerifiedAddresses, verifiedAddressesJsonSql } from "../user-emails";

export async function expireDayWaitlistOffers(db: DatabaseLike, eventId: string): Promise<void> {
  await prepareLapsedDayOfferRequeue(db, { now: nowIso(), eventId }).run();
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
  const option = "held.attendance_type";
  const capacity = eventAttendanceOptionCapacitySql("ed", option);
  const occupied = eventAttendanceOptionOccupiedSql("ed", option, "?");
  const available = eventAttendanceOptionHasAvailableCapacitySql("ed", option, "?");
  const waiting = await all<
    DayWaitlistRow & {
      attendance_type: string;
      verified_addresses: string | null;
      capacity_limit: number | null;
      occupied: number;
    }
  >(
    db,
    `SELECT w.id, w.event_id, w.event_day_id, w.registration_id, w.user_id,
            w.priority_lane, w.status, w.position, w.offer_expires_at, w.reason_code, held.attendance_type,
            ${capacity} AS capacity_limit, (${occupied}) AS occupied,
            ${verifiedAddressesJsonSql("w.user_id")} AS verified_addresses
     FROM event_day_waitlist_entries w
     JOIN registrations r ON r.id = w.registration_id
     JOIN registration_day_attendance held ON held.registration_id = w.registration_id AND held.event_day_id = w.event_day_id
     JOIN event_days ed ON ed.id = w.event_day_id
     WHERE w.event_id = ? AND w.event_day_id = ? AND w.status = 'waiting'
       AND r.status IN ('pending_email_confirmation', 'registered')
       AND ${available}
       AND (w.reason_code = 'admin_returned_to_waitlist' OR ${eventDayOptionAccessSql("ed", "held.attendance_type")} <> 'physical' OR NOT EXISTS (
         SELECT 1 FROM effective_event_participant_roles role
         WHERE role.event_id = w.event_id AND role.user_id = w.user_id
           AND role.status = 'active' AND role.role IN (${ROLE_BASED_CAPACITY_EXEMPT_ROLE_SQL})
       ))
     ORDER BY CASE w.priority_lane WHEN 'continuity' THEN 1 ELSE 2 END ASC, w.position ASC`,
    [nowIso(), payload.eventId, payload.eventDayId, nowIso()],
  );
  // Personal-address entries are handled last; each group keeps its lane and position order.
  const candidates = prioritizeWorkAddresses(waiting, (entry) => parseVerifiedAddresses(entry.verified_addresses)).map(
    ({ verified_addresses: _addresses, ...entry }) => entry,
  );

  for (const candidate of candidates) {
    const now = nowIso();
    const offerExpiresAt = addHours(now, payload.claimWindowHours);
    const candidateType =
      "(SELECT attendance_type FROM registration_day_attendance WHERE registration_id = candidate.registration_id AND event_day_id = candidate.event_day_id)";
    const availableCapacitySql = eventAttendanceOptionHasAvailableCapacitySql("ed", candidateType, "?");
    const updateStatement = db
      .prepare(
        `UPDATE event_day_waitlist_entries AS candidate
       SET status = 'offered', offer_expires_at = ?, updated_at = ?
       WHERE id = ? AND status = 'waiting'
         AND EXISTS (SELECT 1 FROM registration_day_attendance held
           WHERE held.registration_id = candidate.registration_id AND held.event_day_id = candidate.event_day_id
             AND held.attendance_type = ?)
         AND EXISTS (
           SELECT 1
           FROM event_days ed
           WHERE ed.id = ? AND ed.event_id = ?
             AND ${availableCapacitySql}
         )`,
      )
      .bind(offerExpiresAt, now, candidate.id, candidate.attendance_type, payload.eventDayId, payload.eventId, now);
    const promotion = {
      ...candidate,
      status: "offered" as const,
      offer_expires_at: offerExpiresAt,
      capacitySnapshot: {
        seatsReservedBeforeDecision: Number(candidate.occupied),
        limit: candidate.capacity_limit === null ? null : Number(candidate.capacity_limit),
      },
    };
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
