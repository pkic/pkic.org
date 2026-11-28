import { batchRows } from "../../db/pagination";
import type { D1StatementResult } from "../../types";
import type { DatabaseLike } from "../../types";
import {
  publishedRoomsSql,
  publishedSessionIds,
  type PublishedSessionSelection,
  publishedSessionsSql,
} from "./published-schedule";
import { liveOperationalPeopleSql } from "../event-agenda/operational-people";
import { physicalOccupiedSql, remoteOccupiedSql } from "./capacity-accounting";
import { operationalAllocationCompatibleSql, physicalPoolCapacitySql } from "./session-allocation";
import { registrationSessionDayOptionsSql, registrationSessionAttendance } from "./session-access";
import {
  participationAvailability,
  sessionAttendanceModeForDay,
} from "../../../../assets/shared/event-participation-availability";
import type { ParticipationAvailability } from "../../../../assets/shared/schemas/event-participation-availability";
import type { AgendaAdmissionPolicy } from "../../../../assets/shared/schemas/event-agenda";
import { eventReadIdSql, type EventReadSelection } from "../events/selection";
import { nowIso } from "../../utils/time";
/**
 * The published rooms and the operational people of the event, each read once for the whole page of
 * sessions: read per session, the published agenda is parsed again and every earlier revision's people
 * are read again for each of them.
 */
const POOL_ROOMS = "SELECT event_id,id,capacity FROM pool_rooms";
const LIVE_PEOPLE = "SELECT occurrence_id,user_id,attendance_mode,room_id FROM live_people";
interface AvailabilityRow {
  id: string;
  policy: AgendaAdmissionPolicy;
  invitation_required: number;
  invited: number;
  registered: number;
  registration_days_json: string | null;
  startAt: string | null;
  timeZone: string;
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
  return read.decode(sessions.length ? await db.batch(read.statements) : []);
}

export function preparePersonalAvailability(
  db: DatabaseLike,
  eventId: string,
  userId: string,
  sessions: Array<{ id: string; startAt: string | null; timeZone: string }>,
) {
  return preparePersonalAvailabilitySelection(
    db,
    eventId,
    userId,
    publishedSessionIds(sessions.map((session) => session.id)),
  );
}

export function preparePersonalAvailabilitySelection(
  db: DatabaseLike,
  eventSelection: EventReadSelection,
  userId: string,
  selection: PublishedSessionSelection,
) {
  const event = eventReadIdSql(eventSelection);
  const statements = [
    db
      .prepare(`WITH target AS(SELECT ? AS user_id),scope AS MATERIALIZED(SELECT ${event.sql} AS event_id),page AS(${selection.sql}),sessions AS MATERIALIZED(SELECT approved.id,approved.event_id,approved.room_id,approved.additional_room_ids_json,approved.admission_policy,approved.access_policy,approved.booking_opens_at,approved.booking_closes_at,approved.capacity,approved.remote_capacity,approved.start_at,approved.timezone FROM (${publishedSessionsSql}) approved JOIN page ON page.id=approved.id WHERE approved.event_id=(SELECT event_id FROM scope)),
 pool_rooms AS MATERIALIZED(SELECT event_id,id,capacity FROM (${publishedRoomsSql}) WHERE event_id=(SELECT event_id FROM scope)),
 live_people AS MATERIALIZED(${liveOperationalPeopleSql} WHERE person.event_id=(SELECT event_id FROM scope))
 SELECT s.id,s.admission_policy AS policy,s.access_policy='invitation' AS invitation_required,EXISTS(SELECT 1 FROM agenda_session_invitations invite WHERE invite.occurrence_id=s.id AND invite.user_id=target.user_id AND invite.revoked_at IS NULL) AS invited,registration.id IS NOT NULL AS registered,
 ${registrationSessionDayOptionsSql("registration", "s")} AS registration_days_json,s.start_at AS startAt,s.timezone AS timeZone,
 s.booking_opens_at AS opens_at,s.booking_closes_at AS closes_at,
 s.capacity AS physical_capacity,${physicalOccupiedSql("s.id", "target.user_id", undefined, LIVE_PEOPLE)} AS physical_occupied,${physicalPoolCapacitySql("s", POOL_ROOMS)} AS pool_capacity,
 s.remote_capacity,${remoteOccupiedSql("s.id", "target.user_id", undefined, LIVE_PEOPLE)} AS remote_occupied,
 ${operationalAllocationCompatibleSql("s.id", "target.user_id", "'physical'", undefined, LIVE_PEOPLE)} AS physical_compatible,
 ${operationalAllocationCompatibleSql("s.id", "target.user_id", "'remote'", undefined, LIVE_PEOPLE)} AS remote_compatible
 FROM sessions s CROSS JOIN target LEFT JOIN registrations registration ON registration.event_id=s.event_id AND registration.user_id=target.user_id AND registration.status='registered' ORDER BY s.id LIMIT 200`)
      .bind(userId, ...event.bindings, ...selection.bindings),
  ];
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
    const registrationMode = registrationSessionAttendance(row);
    const mode = sessionAttendanceModeForDay(registrationMode);
    availability.set(
      row.id,
      participationAvailability(
        {
          attendanceMode: mode,
          policy: row.policy,
          invitationRequired: Boolean(row.invitation_required),
          invited: Boolean(row.invited),
          registered: Boolean(row.registered),
          registrationMode,
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
