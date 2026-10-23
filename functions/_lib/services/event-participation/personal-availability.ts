import { batchRows } from "../../db/pagination";
import type { D1StatementResult } from "../../types";
import type { DatabaseLike } from "../../types";
import { publishedSessionsSql } from "./published-schedule";
import { physicalOccupiedSql, remoteOccupiedSql } from "./capacity-accounting";
import { operationalAllocationCompatibleSql, physicalPoolCapacitySql } from "./session-allocation";
import { registrationDayAttendanceSql } from "./session-access";
import {
  participationAvailability,
  sessionAttendanceModeForDay,
} from "../../../../assets/shared/event-participation-availability";
import type { ParticipationAvailability } from "../../../../assets/shared/schemas/event-participation-availability";
import type { AgendaAdmissionPolicy } from "../../../../assets/shared/schemas/event-agenda";
import { instantToDateTimeLocal } from "../../../../assets/shared/timezone";
import { nowIso } from "../../utils/time";
interface AvailabilityRow {
  id: string;
  policy: AgendaAdmissionPolicy;
  invitation_required: number;
  invited: number;
  registered: number;
  registration_mode: string | null;
  opens_at: string | null;
  closes_at: string | null;
  physical_capacity: number | null;
  physical_occupied: number;
  pool_capacity: number | null;
  remote_capacity: number | null;
  remote_occupied: number;
  physical_compatible: number;
  remote_compatible: number;
}
/**
 * The viewer's admission per session, in the attendance mode their registration gives them
 * on the session's day; the mode is never chosen per session.
 */
export async function personalAvailability(
  db: DatabaseLike,
  eventId: string,
  userId: string,
  sessions: Array<{ id: string; startAt: string | null; timeZone: string }>,
) {
  const read = preparePersonalAvailability(db, eventId, userId, sessions);
  return read.decode(read.statements.length ? await db.batch(read.statements) : []);
}

export function preparePersonalAvailability(
  db: DatabaseLike,
  eventId: string,
  userId: string,
  sessions: Array<{ id: string; startAt: string | null; timeZone: string }>,
) {
  const days = JSON.stringify(
    sessions.map((session) => ({
      id: session.id,
      date: session.startAt ? instantToDateTimeLocal(session.startAt, session.timeZone).slice(0, 10) : null,
    })),
  );
  const statements = sessions.length
    ? [
        db
          .prepare(
            `WITH target AS(SELECT ? AS user_id),page AS(SELECT json_extract(value,'$.id') AS id,json_extract(value,'$.date') AS day_date FROM json_each(?)),sessions AS(SELECT approved.id,approved.event_id,approved.room_id,approved.additional_room_ids_json,approved.admission_policy,approved.access_policy,approved.booking_opens_at,approved.booking_closes_at,approved.capacity,approved.remote_capacity,page.day_date FROM (${publishedSessionsSql}) approved JOIN page ON page.id=approved.id WHERE approved.event_id=?)
 SELECT s.id,s.admission_policy AS policy,s.access_policy='invitation' AS invitation_required,EXISTS(SELECT 1 FROM agenda_session_invitations invite WHERE invite.occurrence_id=s.id AND invite.user_id=target.user_id AND invite.revoked_at IS NULL) AS invited,registration.id IS NOT NULL AS registered,
 CASE WHEN registration.id IS NULL THEN NULL ELSE ${registrationDayAttendanceSql("registration", "s.day_date")} END AS registration_mode,
 s.booking_opens_at AS opens_at,s.booking_closes_at AS closes_at,
 s.capacity AS physical_capacity,${physicalOccupiedSql("s.id", "target.user_id")} AS physical_occupied,${physicalPoolCapacitySql("s")} AS pool_capacity,
 s.remote_capacity,${remoteOccupiedSql("s.id", "target.user_id")} AS remote_occupied,
 ${operationalAllocationCompatibleSql("s.id", "target.user_id", "'physical'")} AS physical_compatible,
 ${operationalAllocationCompatibleSql("s.id", "target.user_id", "'remote'")} AS remote_compatible
 FROM sessions s CROSS JOIN target LEFT JOIN registrations registration ON registration.event_id=s.event_id AND registration.user_id=target.user_id AND registration.status='registered' ORDER BY s.id LIMIT 200`,
          )
          .bind(userId, days, eventId),
      ]
    : [];
  return {
    statements,
    decode: (loaded: D1StatementResult[]) =>
      decodePersonalAvailability(loaded.length ? batchRows<AvailabilityRow>(loaded[0]) : []),
  };
}

function decodePersonalAvailability(rows: AvailabilityRow[]) {
  const availability = new Map<string, ParticipationAvailability>(),
    clock = nowIso();
  for (const row of rows) {
    const mode = sessionAttendanceModeForDay(row.registration_mode);
    availability.set(
      row.id,
      participationAvailability(
        {
          attendanceMode: mode,
          policy: row.policy,
          invitationRequired: Boolean(row.invitation_required),
          invited: Boolean(row.invited),
          registered: Boolean(row.registered),
          registrationMode: row.registration_mode,
          opensAt: row.opens_at,
          closesAt: row.closes_at,
          sessionCapacity: mode === "remote" ? row.remote_capacity : row.physical_capacity,
          sessionOccupied: Number(mode === "remote" ? row.remote_occupied : row.physical_occupied),
          poolCapacity: mode === "physical" ? row.pool_capacity : null,
          poolOccupied: Number(row.physical_occupied),
          allocationCompatible: Boolean(mode === "remote" ? row.remote_compatible : row.physical_compatible),
        },
        clock,
      ),
    );
  }
  return availability;
}
