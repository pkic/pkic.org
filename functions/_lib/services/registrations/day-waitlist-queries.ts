import { all } from "../../db/queries";
import type { DatabaseLike } from "../../types";
import type { DayWaitlistLane } from "./day-waitlist-types";
import { NON_CAPACITY_CONSUMING_DAY_WAITLIST_SQL } from "./day-waitlist-policy";

export async function listInPersonEventDayIdsForRegistration(
  db: DatabaseLike,
  registrationId: string,
): Promise<string[]> {
  const rows = await all<{ event_day_id: string }>(
    db,
    `SELECT event_day_id
     FROM registration_day_attendance
     WHERE registration_id = ? AND attendance_type = 'in_person'`,
    [registrationId],
  );
  return rows.map((row) => row.event_day_id);
}

export async function listConfirmedInPersonEventDayIdsForRegistration(
  db: DatabaseLike,
  registrationId: string,
): Promise<string[]> {
  const rows = await all<{ event_day_id: string }>(
    db,
    `SELECT rda.event_day_id
     FROM registration_day_attendance rda
     LEFT JOIN event_day_waitlist_entries w
       ON w.event_day_id = rda.event_day_id
      AND w.registration_id = rda.registration_id
      AND ${NON_CAPACITY_CONSUMING_DAY_WAITLIST_SQL}
     WHERE rda.registration_id = ? AND rda.attendance_type = 'in_person' AND w.id IS NULL`,
    [registrationId],
  );
  return rows.map((row) => row.event_day_id);
}

export async function listDayWaitlistForRegistration(
  db: DatabaseLike,
  registrationId: string,
): Promise<Array<{ dayDate: string; status: string; priorityLane: DayWaitlistLane; offerExpiresAt: string | null }>> {
  return all<{ dayDate: string; status: string; priorityLane: DayWaitlistLane; offerExpiresAt: string | null }>(
    db,
    `SELECT ed.day_date AS dayDate, w.status AS status,
            w.priority_lane AS priorityLane, w.offer_expires_at AS offerExpiresAt
     FROM event_day_waitlist_entries w
     JOIN event_days ed ON ed.id = w.event_day_id
     WHERE w.registration_id = ? AND w.status IN ('waiting', 'offered', 'accepted')
     ORDER BY ed.sort_order ASC, ed.day_date ASC`,
    [registrationId],
  );
}
