import type { DatabaseLike, D1StatementResult } from "../../types";
import { batchRows, batchFirst } from "../../db/pagination";
import { nowIso } from "../../utils/time";
import { registrationDayHoldsOptionSql } from "../event-attendance-option-sql";
import { registrationReadIdSql, type RegistrationReadSelection } from "./selection";
import type { DayWaitlistRow } from "./day-waitlist-types";

export interface RegistrationDayCapacityRow {
  event_day_id: string;
  attendance_type: string;
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
      .prepare(`SELECT w.id, w.event_id, w.event_day_id, w.registration_id, w.user_id, w.priority_lane,
              w.status, w.position, w.offer_expires_at, w.reason_code,
              held.attendance_type AS attendance_type
       FROM event_day_waitlist_entries w LEFT JOIN registration_day_attendance held
         ON held.registration_id = w.registration_id AND held.event_day_id = w.event_day_id
       WHERE w.registration_id = ${reference.sql}`)
      .bind(...reference.bindings),
    db
      .prepare(`WITH excluded_registration AS (SELECT COALESCE(${reference.sql}, '') AS id),
       day_types AS (
         SELECT ed.id AS day_id, CASE WHEN json_valid(option.value) THEN json_extract(option.value, '$.value') END AS attendance_type
           FROM event_days ed JOIN json_each(CASE WHEN json_valid(ed.attendance_options_json) THEN
               CASE WHEN json_type(ed.attendance_options_json) = 'array' AND json_array_length(ed.attendance_options_json) > 0
                 THEN ed.attendance_options_json ELSE '[{"value":"in_person"},{"value":"virtual"},{"value":"on_demand"}]' END
             ELSE '[{"value":"in_person"},{"value":"virtual"},{"value":"on_demand"}]' END) option
          WHERE ed.event_id = ? AND json_valid(option.value)
         UNION
         SELECT rda.event_day_id, rda.attendance_type FROM registration_day_attendance rda
          JOIN event_days ed ON ed.id = rda.event_day_id WHERE ed.event_id = ?
       )
       SELECT types.day_id AS event_day_id, types.attendance_type,
          (SELECT COUNT(*) FROM registration_day_attendance rda JOIN registrations r ON r.id = rda.registration_id
            WHERE rda.event_day_id = types.day_id AND rda.attendance_type = types.attendance_type
              AND r.status IN ('pending_email_confirmation', 'registered')
              AND r.id <> (SELECT id FROM excluded_registration)
              AND ${registrationDayHoldsOptionSql("rda", "?")}) AS reserved,
          (SELECT COUNT(*) FROM event_day_waitlist_entries w JOIN registrations r ON r.id = w.registration_id
             JOIN registration_day_attendance held ON held.registration_id = w.registration_id AND held.event_day_id = w.event_day_id
            WHERE w.event_day_id = types.day_id AND held.attendance_type = types.attendance_type
              AND w.status = 'waiting' AND r.status IN ('pending_email_confirmation', 'registered')
              AND r.id <> (SELECT id FROM excluded_registration)) AS waiting,
          (SELECT MAX(position) FROM event_day_waitlist_entries w WHERE w.event_day_id = types.day_id) AS max_position
       FROM day_types types WHERE types.attendance_type IS NOT NULL`)
      .bind(...reference.bindings, input.eventId, input.eventId, at),
    db
      .prepare(
        `SELECT event_day_id, attendance_type FROM registration_day_attendance WHERE registration_id = ${reference.sql}`,
      )
      .bind(...reference.bindings),
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
        previousSelections: batchRows<{ event_day_id: string; attendance_type: string }>(results[2]),
        storedRegistration: input.registrationStatus
          ? { status: input.registrationStatus }
          : batchFirst<{ status: string }>(results[3]),
      };
    },
  };
}
export type RegistrationDayWaitlistSnapshot = ReturnType<
  ReturnType<typeof prepareRegistrationDayWaitlistRead>["decode"]
>;
