import type { AgendaSnapshot } from "../../../../assets/shared/schemas/event-agenda";
import type { DatabaseLike } from "../../types";
import { AppError } from "../../errors";
import { eventReadIdSql, type EventReadSelection } from "../events/selection";

/** Return only candidate/shift conflicts; another event's identity or content never leaves this query. */
export function prepareStaffingUnavailablePairs(
  db: DatabaseLike,
  eventId: EventReadSelection,
  snapshot?: AgendaSnapshot,
) {
  const scope = eventReadIdSql(eventId);
  const eventSql = "(SELECT id FROM availability_event)";
  const sources = [
    {
      from: "event_agenda_occurrences busy JOIN event_agenda_occurrence_speakers person ON person.occurrence_id=busy.id",
      user: "person.user_id",
      scope: `busy.event_id<>${eventSql}`,
      location: "COALESCE(person.room_id,busy.room_id)",
      physical: "person.attendance_mode='physical'",
    },
    {
      from: "event_agenda_shifts busy JOIN event_agenda_assignments person ON person.shift_id=busy.id LEFT JOIN event_agenda_staffing_posts duty_post ON duty_post.event_id=busy.event_id AND duty_post.id=person.post_id LEFT JOIN event_agenda_role_members duty_person ON duty_person.event_id=busy.event_id AND duty_person.user_id=person.user_id",
      user: "person.user_id",
      scope: `busy.event_id<>${eventSql}`,
      location: "CASE WHEN duty_post.id IS NULL THEN busy.room_id ELSE duty_post.room_id END",
      physical: "COALESCE(duty_person.attendance_mode,'physical')='physical'",
    },
    {
      from: "meeting_agenda_speaker_intervals busy",
      user: "busy.user_id",
      scope: `${eventSql} IS NOT NULL`,
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
    FROM ${from} JOIN json_each((SELECT shifts FROM availability_input)) shift
    LEFT JOIN event_agenda_state state ON state.event_id=busy.event_id
    WHERE ${user} IN(SELECT json_extract(value,'$.userId') FROM json_each((SELECT users FROM availability_input))) AND ${scope} AND busy.start_at IS NOT NULL
      AND julianday(json_extract(shift.value,'$.startAt'))<julianday(busy.end_at)+
        CASE WHEN ${physical} AND EXISTS(SELECT 1 FROM json_each((SELECT users FROM availability_input)) available_member WHERE json_extract(available_member.value,'$.userId')=${user} AND json_extract(available_member.value,'$.attendanceMode')='physical') AND (busy.event_id<>${eventSql} OR ${location} IS NOT json_extract(shift.value,'$.roomId')) THEN MAX(COALESCE(state.travel_minutes,0),(SELECT travel FROM availability_input))/1440.0 ELSE 0 END
      AND julianday(busy.start_at)<julianday(json_extract(shift.value,'$.endAt'))+
        CASE WHEN ${physical} AND EXISTS(SELECT 1 FROM json_each((SELECT users FROM availability_input)) available_member WHERE json_extract(available_member.value,'$.userId')=${user} AND json_extract(available_member.value,'$.attendanceMode')='physical') AND (busy.event_id<>${eventSql} OR ${location} IS NOT json_extract(shift.value,'$.roomId')) THEN MAX(COALESCE(state.travel_minutes,0),(SELECT travel FROM availability_input))/1440.0 ELSE 0 END`,
  );
  let input: string;
  let bindings: unknown[];
  if (snapshot) {
    const shifts = JSON.stringify(
      snapshot.staffingPositions.map((position) => {
        const requirement = snapshot.staffingRequirements.find((candidate) => candidate.id === position.requirementId)!;
        const shift = snapshot.shifts.find((candidate) => candidate.id === requirement.shiftId)!;
        const post = snapshot.staffingPosts.find((candidate) => candidate.id === requirement.postId);
        return {
          id: position.id,
          startAt: shift.startAt,
          endAt: shift.endAt,
          roomId: post ? post.roomId : shift.roomId,
        };
      }),
    );
    const users = JSON.stringify(
      snapshot.roleMembers.map(({ userId, attendanceMode }) => ({ userId, attendanceMode })),
    );

    input = "SELECT ? AS shifts,? AS users,? AS travel";
    bindings = [shifts, users, snapshot.travelMinutes];
  } else {
    input = `SELECT
      (SELECT json_group_array(json_object('id',position.id,'startAt',shift.start_at,'endAt',shift.end_at,
        'roomId',CASE WHEN post.id IS NULL THEN shift.room_id ELSE post.room_id END))
       FROM (SELECT id,requirement_id FROM event_agenda_staffing_positions WHERE event_id=${eventSql} ORDER BY requirement_id,position_index LIMIT 2000) position
       JOIN event_agenda_staffing_requirements requirement ON requirement.id=position.requirement_id
       JOIN event_agenda_shifts shift ON shift.id=requirement.shift_id
       LEFT JOIN event_agenda_staffing_posts post ON post.event_id=shift.event_id AND post.id=requirement.post_id
       WHERE NOT EXISTS(SELECT 1 FROM event_agenda_assignments assignment WHERE assignment.position_id=position.id)) AS shifts,
      (SELECT json_group_array(json_object('userId',user_id,'attendanceMode',attendance_mode))
       FROM (SELECT user_id,attendance_mode FROM event_agenda_role_members WHERE event_id=${eventSql} LIMIT 200)) AS users,
      COALESCE((SELECT travel_minutes FROM event_agenda_state WHERE event_id=${eventSql}),0) AS travel`;
    bindings = [];
  }
  return db
    .prepare(
      `WITH availability_event AS(SELECT ${scope.sql} AS id),availability_input AS(${input}) ${statements.join(" UNION ")} LIMIT 400001`,
    )
    .bind(...scope.bindings, ...bindings);
}

export function decodeStaffingUnavailablePairs(rows: { shiftId: string; userId: string }[]) {
  if (rows.length > 400000)
    throw new AppError(
      422,
      "AGENDA_AVAILABILITY_LIMIT",
      "Reduce the staffing shifts or eligible pool before generating assignments",
    );
  return rows;
}

export async function getStaffingUnavailablePairs(db: DatabaseLike, eventId: string, snapshot: AgendaSnapshot) {
  if (!snapshot.shifts.length || !snapshot.roleMembers.length) return [];
  const { results } = await prepareStaffingUnavailablePairs(db, eventId, snapshot).all<{
    shiftId: string;
    userId: string;
  }>();
  return decodeStaffingUnavailablePairs(results);
}
