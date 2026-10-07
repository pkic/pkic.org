import type { AgendaSnapshot } from "../../../../assets/shared/schemas/event-agenda";
import type { DatabaseLike } from "../../types";
import { all } from "../../db/queries";
import { AppError } from "../../errors";

/** Return only candidate/shift conflicts; another event's identity or content never leaves this query. */
export async function getStaffingUnavailablePairs(db: DatabaseLike, eventId: string, snapshot: AgendaSnapshot) {
  if (!snapshot.shifts.length || !snapshot.roleMembers.length) return [];
  const sources = [
    {
      from: "event_agenda_occurrences busy JOIN event_agenda_occurrence_speakers person ON person.occurrence_id=busy.id",
      user: "person.user_id",
      scope: "busy.event_id<>?",
      location: "COALESCE(person.room_id,busy.room_id)",
      physical: "person.attendance_mode='physical'",
    },
    {
      from: "event_agenda_shifts busy JOIN event_agenda_assignments person ON person.shift_id=busy.id LEFT JOIN event_agenda_staffing_posts duty_post ON duty_post.event_id=busy.event_id AND duty_post.id=person.post_id LEFT JOIN event_agenda_role_members duty_person ON duty_person.event_id=busy.event_id AND duty_person.user_id=person.user_id",
      user: "person.user_id",
      scope: "busy.event_id<>?",
      location: "CASE WHEN duty_post.id IS NULL THEN busy.room_id ELSE duty_post.room_id END",
      physical: "COALESCE(duty_person.attendance_mode,'physical')='physical'",
    },
    {
      from: "meeting_agenda_speaker_intervals busy",
      user: "busy.user_id",
      scope: "? IS NOT NULL",
      location: "busy.room_id",
      physical: "1=1",
    },
  ];
  const statements = sources.map(
    ({
      from,
      user,
      scope,
      location,
      physical,
    }) => `SELECT DISTINCT json_extract(shift.value,'$.id') AS shiftId,${user} AS userId
    FROM ${from} JOIN json_each(?) shift
    LEFT JOIN event_agenda_state state ON state.event_id=busy.event_id
    WHERE ${user} IN(SELECT json_extract(value,'$.userId') FROM json_each(?)) AND ${scope} AND busy.start_at IS NOT NULL
      AND julianday(json_extract(shift.value,'$.startAt'))<julianday(busy.end_at)+
        CASE WHEN ${physical} AND EXISTS(SELECT 1 FROM json_each(?) available_member WHERE json_extract(available_member.value,'$.userId')=${user} AND json_extract(available_member.value,'$.attendanceMode')='physical') AND (busy.event_id<>? OR ${location} IS NOT json_extract(shift.value,'$.roomId')) THEN MAX(COALESCE(state.travel_minutes,0),?)/1440.0 ELSE 0 END
      AND julianday(busy.start_at)<julianday(json_extract(shift.value,'$.endAt'))+
        CASE WHEN ${physical} AND EXISTS(SELECT 1 FROM json_each(?) available_member WHERE json_extract(available_member.value,'$.userId')=${user} AND json_extract(available_member.value,'$.attendanceMode')='physical') AND (busy.event_id<>? OR ${location} IS NOT json_extract(shift.value,'$.roomId')) THEN MAX(COALESCE(state.travel_minutes,0),?)/1440.0 ELSE 0 END`,
  );
  const shifts = JSON.stringify(
    snapshot.staffingPositions.map((position) => {
      const requirement = snapshot.staffingRequirements.find((candidate) => candidate.id === position.requirementId)!;
      const shift = snapshot.shifts.find((candidate) => candidate.id === requirement.shiftId)!;
      const post = snapshot.staffingPosts.find((candidate) => candidate.id === requirement.postId);
      return { id: position.id, startAt: shift.startAt, endAt: shift.endAt, roomId: post ? post.roomId : shift.roomId };
    }),
  );
  const users = JSON.stringify(snapshot.roleMembers.map(({ userId, attendanceMode }) => ({ userId, attendanceMode })));
  const rows = await all<{ shiftId: string; userId: string }>(
    db,
    `${statements.join(" UNION ")} LIMIT 400001`,
    sources.flatMap(() => [
      shifts,
      users,
      eventId,
      users,
      eventId,
      snapshot.travelMinutes,
      users,
      eventId,
      snapshot.travelMinutes,
    ]),
  );
  if (rows.length > 400000)
    throw new AppError(
      422,
      "AGENDA_AVAILABILITY_LIMIT",
      "Reduce the staffing shifts or eligible pool before generating assignments",
    );
  return rows;
}
