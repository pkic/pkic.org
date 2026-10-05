import { all } from "../../db/queries";
import type { DatabaseLike } from "../../types";
import { publishedSessionsSql, publishedRoomsSql } from "./published-schedule";
import { physicalOccupiedSql, physicalRoomOccupiedSql, remoteOccupiedSql } from "./capacity-accounting";
import { operationalAllocationCompatibleSql } from "./session-allocation";
import { participationAvailability } from "../../../../assets/shared/event-participation-availability";
import type { ParticipationAvailability } from "../../../../assets/shared/schemas/event-participation-availability";
import { instantToDateTimeLocal } from "../../../../assets/shared/timezone";
import { nowIso } from "../../utils/time";
interface AvailabilityRow {
  id: string;
  policy: "preference" | "reservation" | "approval";
  invitation_required: number;
  invited: number;
  registered: number;
  registration_mode: string | null;
  opens_at: string | null;
  closes_at: string | null;
  attendance_mode: "physical" | "remote";
  room_id: string | null;
  session_capacity: number | null;
  session_occupied: number;
  room_capacity: number | null;
  room_occupied: number;
  allocation_compatible: number;
}
export async function personalAvailability(
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
  const context = `WITH target AS(SELECT ? AS user_id),page AS(SELECT json_extract(value,'$.id') AS id,json_extract(value,'$.date') AS day_date FROM json_each(?)),sessions AS(SELECT approved.id,approved.event_id,approved.room_id,approved.additional_room_ids_json,approved.admission_policy,approved.access_policy,approved.booking_opens_at,approved.booking_closes_at,approved.capacity,approved.remote_capacity,page.day_date FROM (${publishedSessionsSql}) approved JOIN page ON page.id=approved.id WHERE approved.event_id=?),modes AS(SELECT 'physical' AS attendance_mode UNION SELECT 'remote')`;
  const rows = sessions.length
    ? await all<AvailabilityRow>(
        db,
        `${context} SELECT s.id,s.admission_policy AS policy,s.access_policy='invitation' AS invitation_required,EXISTS(SELECT 1 FROM agenda_session_invitations invite WHERE invite.occurrence_id=s.id AND invite.user_id=target.user_id AND invite.revoked_at IS NULL) AS invited,registration.id IS NOT NULL AS registered,
 COALESCE((SELECT attendance.attendance_type FROM registration_day_attendance attendance JOIN event_days day ON day.id=attendance.event_day_id WHERE attendance.registration_id=registration.id AND day.day_date=s.day_date),CASE WHEN EXISTS(SELECT 1 FROM event_days day WHERE day.event_id=s.event_id AND day.day_date=s.day_date) THEN 'none' ELSE registration.attendance_type END) AS registration_mode,
 s.booking_opens_at AS opens_at,s.booking_closes_at AS closes_at,mode.attendance_mode,CASE WHEN mode.attendance_mode='remote' THEN NULL ELSE room.id END AS room_id,
 CASE mode.attendance_mode WHEN 'physical' THEN s.capacity ELSE s.remote_capacity END AS session_capacity,
 CASE mode.attendance_mode WHEN 'physical' THEN ${physicalOccupiedSql("s.id", "target.user_id")} ELSE ${remoteOccupiedSql("s.id", "target.user_id")} END AS session_occupied,
 CASE WHEN mode.attendance_mode='physical' THEN room.capacity ELSE NULL END AS room_capacity,
 CASE WHEN mode.attendance_mode='physical' THEN ${physicalRoomOccupiedSql("s.id", "room.id", "target.user_id")} ELSE 0 END AS room_occupied,
 ${operationalAllocationCompatibleSql("s.id", "target.user_id", "mode.attendance_mode", "CASE WHEN mode.attendance_mode='physical' THEN room.id ELSE NULL END")} AS allocation_compatible
 FROM sessions s CROSS JOIN target CROSS JOIN modes mode LEFT JOIN (${publishedRoomsSql}) room ON mode.attendance_mode='physical' AND room.event_id=s.event_id AND (room.id=s.room_id OR EXISTS(SELECT 1 FROM json_each(s.additional_room_ids_json) selected WHERE selected.value=room.id)) LEFT JOIN registrations registration ON registration.event_id=s.event_id AND registration.user_id=target.user_id AND registration.status='registered' ORDER BY s.id,mode.attendance_mode,room.id LIMIT 4200`,
        [userId, days, eventId],
      )
    : [];
  const groups = new Map<string, ParticipationAvailability[]>(),
    clock = nowIso();
  for (const row of rows) {
    const group = groups.get(row.id) ?? [];
    group.push(
      participationAvailability(
        {
          attendanceMode: row.attendance_mode,
          roomId: row.room_id,
          policy: row.policy,
          invitationRequired: Boolean(row.invitation_required),
          invited: Boolean(row.invited),
          registered: Boolean(row.registered),
          registrationMode: row.registration_mode,
          opensAt: row.opens_at,
          closesAt: row.closes_at,
          sessionCapacity: row.session_capacity,
          sessionOccupied: Number(row.session_occupied),
          roomCapacity: row.room_capacity,
          roomOccupied: Number(row.room_occupied),
          allocationCompatible: Boolean(row.allocation_compatible),
        },
        clock,
      ),
    );
    groups.set(row.id, group);
  }
  return groups;
}
