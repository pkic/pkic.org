import type { DatabaseLike, D1StatementResult } from "../../types";
import { batchRows, batchFirst } from "../../db/pagination";
import { nowIso } from "../../utils/time";
import { NON_CAPACITY_CONSUMING_DAY_WAITLIST_SQL } from "./day-waitlist-policy";
import { registrationReadIdSql, type RegistrationReadSelection } from "./selection";
import type { DayWaitlistRow } from "./day-waitlist-types";

export interface RegistrationDayCapacityRow {
  event_day_id: string;
  reserved: number;
  waiting: number;
  max_position: number | null;
}

/** Read-only preflight; the caller's capacity revisions still fence the atomic write. */
export function prepareRegistrationDayWaitlistRead(
  db: DatabaseLike,
  input: { eventId: string; registration: RegistrationReadSelection; registrationStatus?: string },
) {
  const reference = registrationReadIdSql(input.registration);
  const at = nowIso();
  const statements = [
    db
      .prepare(`SELECT id, event_id, event_day_id, registration_id, user_id, priority_lane,
              status, position, offer_expires_at, reason_code
       FROM event_day_waitlist_entries WHERE registration_id = ${reference.sql}`)
      .bind(...reference.bindings),
    db
      .prepare(`WITH excluded_registration AS (SELECT COALESCE(${reference.sql}, '') AS id) SELECT ed.id AS event_day_id,
              (
                SELECT COUNT(*)
                FROM registration_day_attendance rda
                JOIN registrations r ON r.id = rda.registration_id
                LEFT JOIN event_day_waitlist_entries w
                  ON w.event_day_id = rda.event_day_id
                 AND w.registration_id = rda.registration_id
                 AND ${NON_CAPACITY_CONSUMING_DAY_WAITLIST_SQL}
                WHERE rda.event_day_id = ed.id
                  AND rda.attendance_type = 'in_person'
                  AND r.status IN ('pending_email_confirmation', 'registered')
                  AND w.id IS NULL
                  AND r.id <> (SELECT id FROM excluded_registration)
              ) + (
                SELECT COUNT(*)
                FROM event_day_waitlist_entries w
                JOIN registrations r ON r.id = w.registration_id
                WHERE w.event_day_id = ed.id
                  AND w.status = 'offered'
                  AND (w.offer_expires_at IS NULL OR w.offer_expires_at > ?)
                  AND r.status IN ('pending_email_confirmation', 'registered')
                  AND r.id <> (SELECT id FROM excluded_registration)
              ) AS reserved,
              (SELECT COUNT(*)
               FROM event_day_waitlist_entries w
               JOIN registrations r ON r.id = w.registration_id
               WHERE w.event_day_id = ed.id
                 AND w.status = 'waiting'
                 AND r.status IN ('pending_email_confirmation', 'registered')
                 AND w.registration_id <> (SELECT id FROM excluded_registration)) AS waiting,
              (SELECT MAX(position) FROM event_day_waitlist_entries w WHERE w.event_day_id = ed.id) AS max_position
       FROM event_days ed WHERE ed.event_id = ?`)
      .bind(...reference.bindings, at, input.eventId),
    ...(input.registrationStatus
      ? []
      : [db.prepare(`SELECT status FROM registrations WHERE id=${reference.sql}`).bind(...reference.bindings)]),
  ];
  return {
    statements,
    decode(results: D1StatementResult[]) {
      return {
        at,
        existingRows: batchRows<DayWaitlistRow>(results[0]),
        capacityRows: batchRows<RegistrationDayCapacityRow>(results[1]),
        storedRegistration: input.registrationStatus
          ? { status: input.registrationStatus }
          : batchFirst<{ status: string }>(results[2]),
      };
    },
  };
}
export type RegistrationDayWaitlistSnapshot = ReturnType<
  ReturnType<typeof prepareRegistrationDayWaitlistRead>["decode"]
>;
