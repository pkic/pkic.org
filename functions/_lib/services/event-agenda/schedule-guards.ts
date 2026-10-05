import type { DatabaseLike } from "../../types";

/** The canonical person ID, rather than credited organization, owns availability. */
const speakerConflict = `SELECT 1
  FROM event_agenda_occurrences local
  JOIN event_agenda_occurrence_speakers person ON person.occurrence_id=local.id
  JOIN event_agenda_occurrence_speakers other_person ON other_person.user_id=person.user_id
  JOIN event_agenda_occurrences other ON other.id=other_person.occurrence_id AND other.id<>local.id
  LEFT JOIN event_agenda_state local_state ON local_state.event_id=local.event_id
  LEFT JOIN event_agenda_state other_state ON other_state.event_id=other.event_id
 WHERE local.event_id=? AND local.start_at IS NOT NULL AND other.start_at IS NOT NULL
   AND julianday(local.start_at)<julianday(other.end_at)+
       CASE WHEN person.attendance_mode='physical' AND other_person.attendance_mode='physical' AND (local.event_id<>other.event_id OR COALESCE(person.room_id,local.room_id) IS NOT COALESCE(other_person.room_id,other.room_id))
            THEN MAX(COALESCE(local_state.travel_minutes,0),COALESCE(other_state.travel_minutes,0))/1440.0 ELSE 0 END
   AND julianday(other.start_at)<julianday(local.end_at)+
       CASE WHEN person.attendance_mode='physical' AND other_person.attendance_mode='physical' AND (local.event_id<>other.event_id OR COALESCE(person.room_id,local.room_id) IS NOT COALESCE(other_person.room_id,other.room_id))
            THEN MAX(COALESCE(local_state.travel_minutes,0),COALESCE(other_state.travel_minutes,0))/1440.0 ELSE 0 END`;

const speakerDutyConflict = `SELECT 1
  FROM event_agenda_occurrences occurrence
  JOIN event_agenda_occurrence_speakers speaker ON speaker.occurrence_id=occurrence.id
  JOIN event_agenda_assignments assignment ON assignment.user_id=speaker.user_id
  JOIN event_agenda_blocks block ON block.id=assignment.block_id
  LEFT JOIN event_agenda_staffing_posts duty_post ON duty_post.event_id=block.event_id AND duty_post.id=assignment.post_id
  LEFT JOIN event_agenda_role_members duty_person ON duty_person.event_id=block.event_id AND duty_person.user_id=assignment.user_id
  LEFT JOIN event_agenda_state occurrence_state ON occurrence_state.event_id=occurrence.event_id
  LEFT JOIN event_agenda_state block_state ON block_state.event_id=block.event_id
 WHERE occurrence.event_id=? AND occurrence.start_at IS NOT NULL
   AND julianday(occurrence.start_at)<julianday(block.end_at)+
       CASE WHEN speaker.attendance_mode='physical' AND COALESCE(duty_person.attendance_mode,'physical')='physical' AND (occurrence.event_id<>block.event_id OR COALESCE(speaker.room_id,occurrence.room_id) IS NOT (CASE WHEN duty_post.id IS NULL THEN block.room_id ELSE duty_post.room_id END))
            THEN MAX(COALESCE(occurrence_state.travel_minutes,0),COALESCE(block_state.travel_minutes,0))/1440.0 ELSE 0 END
   AND julianday(block.start_at)<julianday(occurrence.end_at)+
       CASE WHEN speaker.attendance_mode='physical' AND COALESCE(duty_person.attendance_mode,'physical')='physical' AND (occurrence.event_id<>block.event_id OR COALESCE(speaker.room_id,occurrence.room_id) IS NOT (CASE WHEN duty_post.id IS NULL THEN block.room_id ELSE duty_post.room_id END))
            THEN MAX(COALESCE(occurrence_state.travel_minutes,0),COALESCE(block_state.travel_minutes,0))/1440.0 ELSE 0 END`;

const dutyConflict = `SELECT 1
  FROM event_agenda_blocks local
  JOIN event_agenda_assignments assignment ON assignment.block_id=local.id
  JOIN event_agenda_assignments other_assignment ON other_assignment.user_id=assignment.user_id
  JOIN event_agenda_blocks other ON other.id=other_assignment.block_id
  LEFT JOIN event_agenda_staffing_posts local_post ON local_post.event_id=local.event_id AND local_post.id=assignment.post_id
  LEFT JOIN event_agenda_staffing_posts other_post ON other_post.event_id=other.event_id AND other_post.id=other_assignment.post_id
  LEFT JOIN event_agenda_role_members local_person ON local_person.event_id=local.event_id AND local_person.user_id=assignment.user_id
  LEFT JOIN event_agenda_role_members other_person_mode ON other_person_mode.event_id=other.event_id AND other_person_mode.user_id=other_assignment.user_id
  LEFT JOIN event_agenda_state local_state ON local_state.event_id=local.event_id
  LEFT JOIN event_agenda_state other_state ON other_state.event_id=other.event_id
 WHERE local.event_id=? AND (assignment.event_id<>other_assignment.event_id OR assignment.position_id<>other_assignment.position_id)
   AND NOT(local.id=other.id AND assignment.post_id IS other_assignment.post_id AND assignment.role<>other_assignment.role AND EXISTS(SELECT 1 FROM json_each(local.compatible_roles_json) pair WHERE
     (json_extract(pair.value,'$[0]')=assignment.role AND json_extract(pair.value,'$[1]')=other_assignment.role) OR
     (json_extract(pair.value,'$[1]')=assignment.role AND json_extract(pair.value,'$[0]')=other_assignment.role)))
   AND julianday(local.start_at)<julianday(other.end_at)+
       CASE WHEN COALESCE(local_person.attendance_mode,'physical')='physical' AND COALESCE(other_person_mode.attendance_mode,'physical')='physical' AND (local.event_id<>other.event_id OR (CASE WHEN local_post.id IS NULL THEN local.room_id ELSE local_post.room_id END) IS NOT (CASE WHEN other_post.id IS NULL THEN other.room_id ELSE other_post.room_id END))
            THEN MAX(COALESCE(local_state.travel_minutes,0),COALESCE(other_state.travel_minutes,0))/1440.0 ELSE 0 END
   AND julianday(other.start_at)<julianday(local.end_at)+
       CASE WHEN COALESCE(local_person.attendance_mode,'physical')='physical' AND COALESCE(other_person_mode.attendance_mode,'physical')='physical' AND (local.event_id<>other.event_id OR (CASE WHEN local_post.id IS NULL THEN local.room_id ELSE local_post.room_id END) IS NOT (CASE WHEN other_post.id IS NULL THEN other.room_id ELSE other_post.room_id END))
            THEN MAX(COALESCE(local_state.travel_minutes,0),COALESCE(other_state.travel_minutes,0))/1440.0 ELSE 0 END`;

/** A physical track duty follows actual occurrences rather than treating an unspecified room as a location. */
const trackDutyConflict = `WITH intervals AS (
  SELECT assignment.position_id,occurrence.id AS occurrence_id,
    MAX(block.start_at,occurrence.start_at) AS start_at,MIN(block.end_at,occurrence.end_at) AS end_at,
    COALESCE(CASE WHEN post.id IS NULL THEN block.room_id ELSE post.room_id END,occurrence.room_id) AS room_id,
    CASE WHEN (CASE WHEN post.id IS NULL THEN block.room_id ELSE post.room_id END) IS NULL
      AND (CASE WHEN occurrence.room_id IS NULL THEN 0 ELSE 1 END)+
        (SELECT COUNT(*) FROM event_agenda_occurrence_rooms room WHERE room.occurrence_id=occurrence.id)>1
      THEN 1 ELSE 0 END AS ambiguous_room,
    COALESCE(state.travel_minutes,0) AS travel_minutes
  FROM event_agenda_blocks block
  JOIN event_agenda_assignments assignment ON assignment.block_id=block.id
  JOIN event_agenda_role_members person ON person.event_id=block.event_id AND person.user_id=assignment.user_id
  LEFT JOIN event_agenda_staffing_posts post ON post.event_id=block.event_id AND post.id=assignment.post_id
  LEFT JOIN event_agenda_state state ON state.event_id=block.event_id
  JOIN event_agenda_occurrences occurrence ON occurrence.event_id=block.event_id AND occurrence.track=block.track
  WHERE block.event_id=? AND block.track IS NOT NULL AND person.attendance_mode='physical'
    AND occurrence.start_at<block.end_at AND block.start_at<occurrence.end_at
    AND (block.room_id IS NULL OR occurrence.room_id=block.room_id OR EXISTS(
      SELECT 1 FROM event_agenda_occurrence_rooms room WHERE room.occurrence_id=occurrence.id AND room.room_id=block.room_id))
    AND (post.room_id IS NULL OR occurrence.room_id=post.room_id OR EXISTS(
      SELECT 1 FROM event_agenda_occurrence_rooms room WHERE room.occurrence_id=occurrence.id AND room.room_id=post.room_id))
) SELECT 1 FROM intervals local WHERE (local.ambiguous_room=1 OR EXISTS(
  SELECT 1 FROM intervals other WHERE other.position_id=local.position_id AND other.occurrence_id<>local.occurrence_id
    AND julianday(local.start_at)<julianday(other.end_at)+
      CASE WHEN local.room_id IS NOT other.room_id THEN local.travel_minutes/1440.0 ELSE 0 END
    AND julianday(other.start_at)<julianday(local.end_at)+
      CASE WHEN local.room_id IS NOT other.room_id THEN local.travel_minutes/1440.0 ELSE 0 END
))`;

/** Indexed meeting intervals participate in the same canonical-person policy. */
const meetingSources = [
  {
    from: "event_agenda_occurrences other JOIN event_agenda_occurrence_speakers other_person ON other_person.occurrence_id=other.id",
    person: "other_person.user_id",
    self: "other.start_at IS NOT NULL",
    location:
      "CASE WHEN other_person.attendance_mode='physical' THEN COALESCE(other_person.room_id,other.room_id) ELSE NULL END",
    physical: "other_person.attendance_mode='physical'",
  },
  {
    from: "event_agenda_blocks other JOIN event_agenda_assignments other_person ON other_person.block_id=other.id LEFT JOIN event_agenda_staffing_posts duty_post ON duty_post.event_id=other.event_id AND duty_post.id=other_person.post_id LEFT JOIN event_agenda_role_members duty_person ON duty_person.event_id=other.event_id AND duty_person.user_id=other_person.user_id",
    person: "other_person.user_id",
    self: "1=1",
    location: "(CASE WHEN duty_post.id IS NULL THEN other.room_id ELSE duty_post.room_id END)",
    physical: "COALESCE(duty_person.attendance_mode,'physical')='physical'",
  },
  {
    from: "meeting_agenda_speaker_intervals other",
    person: "other.user_id",
    self: "(local.occurrence_id<>other.occurrence_id OR local.item_id<>other.item_id)",
    location: "other.room_id",
    physical: "1=1",
  },
];
const meetingConflicts = meetingSources.flatMap((source, index) => {
  const query = `SELECT 1 FROM meeting_agenda_speaker_intervals local
    JOIN ${index === 2 ? source.from : `(${source.from})`} ON ${source.person}=local.user_id
    LEFT JOIN event_agenda_state local_state ON local_state.event_id=local.event_id
    LEFT JOIN event_agenda_state other_state ON other_state.event_id=other.event_id
    WHERE local.event_id=? AND ${source.self}
      AND julianday(local.start_at)<julianday(other.end_at)+
        CASE WHEN ${source.physical} AND (local.event_id<>other.event_id OR local.room_id IS NOT ${source.location})
          THEN MAX(COALESCE(local_state.travel_minutes,0),COALESCE(other_state.travel_minutes,0))/1440.0 ELSE 0 END
      AND julianday(other.start_at)<julianday(local.end_at)+
        CASE WHEN ${source.physical} AND (local.event_id<>other.event_id OR local.room_id IS NOT ${source.location})
          THEN MAX(COALESCE(local_state.travel_minutes,0),COALESCE(other_state.travel_minutes,0))/1440.0 ELSE 0 END`;
  return index === 2 ? [query] : [query, query.replace("WHERE local.event_id=?", "WHERE other.event_id=?")];
});

/** Evaluate after all candidate writes, inside their transaction, including swaps and imports. */
export function prepareAgendaScheduleGuard(db: DatabaseLike, eventId: string) {
  const id = crypto.randomUUID();
  return [
    db
      .prepare(
        `INSERT INTO event_agenda_schedule_guards(id,event_id,valid)
      SELECT ?,?,CASE WHEN EXISTS(${speakerConflict}) OR EXISTS(${speakerDutyConflict})
        OR EXISTS(${speakerDutyConflict.replace("WHERE occurrence.event_id=?", "WHERE block.event_id=?")})
        OR EXISTS(${dutyConflict}) OR EXISTS(${trackDutyConflict}) ${meetingConflicts.map((query) => `OR EXISTS(${query})`).join(" ")} THEN 0 ELSE 1 END`,
      )
      .bind(id, eventId, eventId, eventId, eventId, eventId, eventId, ...meetingConflicts.map(() => eventId)),
    db.prepare("DELETE FROM event_agenda_schedule_guards WHERE id=?").bind(id),
  ];
}

export function isAgendaScheduleGuardFailure(error: unknown) {
  return error instanceof Error && error.message.includes("agenda_schedule_valid");
}

/** Read-side indicators reuse the exact speaker and duty predicates enforced on writes. */
export function agendaOccurrencePersonConflictSql(alias: string) {
  return {
    speaker_conflict: `EXISTS(${speakerConflict.replace("local.event_id=?", `local.id=${alias}.id`)})`,
    speaker_duty_conflict: `(EXISTS(${speakerDutyConflict.replace("occurrence.event_id=?", `occurrence.id=${alias}.id`)}) OR EXISTS(${trackDutyConflict
      .replace("block.event_id=?", `block.event_id=${alias}.event_id`)
      .replace("FROM intervals local WHERE", `FROM intervals local WHERE local.occurrence_id=${alias}.id AND`)}))`,
  };
}
