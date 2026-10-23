import { prepareStaffingUnavailablePairs, decodeStaffingUnavailablePairs } from "../event-agenda/staffing-availability";
import { prepareAgendaRead } from "../event-agenda/read";
import { evaluateRoomFits } from "../../../../assets/shared/event-agenda-room-fit";
import { roomRecommendationsResponseSchema } from "../../../../assets/shared/schemas/event-room-recommendations";
import { batchFirst, batchRows } from "../../db/pagination";
import type { DatabaseLike, D1StatementResult, Env } from "../../types";
import { eventReadIdSql, type EventReadSelection } from "../events/selection";
import { readSessionParticipantResource } from "./management-authorization";
import { AppError } from "../../errors";
import {
  physicalAllocatedPeopleSql,
  physicalOccupiedSql,
  operationalRoomOccupiedSql,
  remoteOccupiedSql,
} from "./capacity-accounting";
import { liveOperationalPeopleSql } from "../event-agenda/operational-people";
import { prepareSessionDemand } from "./session-demand";
export async function roomRecommendations(db: DatabaseLike, eventId: string, eventSlug: string, occurrenceId: string) {
  const read = prepareRoomRecommendations(db, eventId, eventSlug, occurrenceId);
  return read.decode(await db.batch(read.statements));
}

export async function readRoomRecommendationsRequest(
  db: DatabaseLike,
  request: Request,
  env: Pick<Env, "INTERNAL_SIGNING_SECRET">,
  eventSlug: string,
  occurrenceId: string,
) {
  return readSessionParticipantResource(db, request, env, eventSlug, occurrenceId, (event) => {
    const read = prepareRoomRecommendations(db, event, eventSlug, occurrenceId);
    return {
      statements: read.statements,
      decode(loaded, context) {
        if (!context.canDelegate)
          throw new AppError(
            403,
            "ROOM_RECOMMENDATIONS_ORGANIZER_REQUIRED",
            "Only organizers can review location recommendations.",
          );
        return read.decode(loaded);
      },
    };
  });
}

function prepareRoomRecommendations(
  db: DatabaseLike,
  eventId: EventReadSelection,
  eventSlug: string,
  occurrenceId: string,
) {
  const agenda = prepareAgendaRead(db, eventId, eventSlug);
  const demandRead = prepareSessionDemand(db, eventId, { sql: "SELECT ? AS id", bindings: [occurrenceId] }, 1);
  const scope = eventReadIdSql(eventId);
  // Candidate locations and credited people supply inputs to the canonical cross-event conflict policy.
  const availability = prepareStaffingUnavailablePairs(db, eventId, {
    sql: `SELECT
      (SELECT json_group_array(json_object('id',room.id,'startAt',session.start_at,'endAt',session.end_at,'roomId',room.id))
       FROM (SELECT id FROM event_agenda_rooms WHERE event_id=(SELECT id FROM availability_event) ORDER BY name,id LIMIT 200) room
       JOIN event_agenda_occurrences session ON session.id=? AND session.event_id=(SELECT id FROM availability_event)
       WHERE session.start_at IS NOT NULL AND session.end_at IS NOT NULL) AS shifts,
      (SELECT json_group_array(json_object('userId',speaker.user_id,'attendanceMode',speaker.attendance_mode))
       FROM event_agenda_occurrence_speakers speaker JOIN users person ON person.id=speaker.user_id
       JOIN event_agenda_occurrences session ON session.id=speaker.occurrence_id
       WHERE session.id=? AND session.event_id=(SELECT id FROM availability_event)) AS users,
      COALESCE((SELECT travel_minutes FROM event_agenda_state WHERE event_id=(SELECT id FROM availability_event)),0) AS travel`,
    bindings: [occurrenceId, occurrenceId],
  });
  return {
    statements: [
      ...agenda.statements,
      ...demandRead.statements,
      db
        .prepare(
          `WITH target AS(SELECT ? AS id) SELECT ${physicalOccupiedSql("target.id")} AS physical,${remoteOccupiedSql("target.id")} AS remote,(SELECT COUNT(DISTINCT p.user_id) FROM agenda_session_participations p WHERE p.occurrence_id=target.id AND p.attendance_mode='physical' AND p.status IN('approval_pending','waitlisted') AND NOT EXISTS(SELECT 1 FROM (${physicalAllocatedPeopleSql("target.id")}) allocated WHERE allocated.user_id=p.user_id)) AS unallocated FROM target`,
        )
        .bind(occurrenceId),
      db
        .prepare(
          `SELECT DISTINCT person.room_id FROM (${liveOperationalPeopleSql}) person WHERE person.occurrence_id=? AND person.attendance_mode='physical' LIMIT 200`,
        )
        .bind(occurrenceId),
      db
        .prepare(
          `WITH target AS(SELECT ? AS id) SELECT room.id,${operationalRoomOccupiedSql("target.id", "room.id")} AS occupied FROM event_agenda_rooms room CROSS JOIN target WHERE room.event_id=${scope.sql} LIMIT 200`,
        )
        .bind(occurrenceId, ...scope.bindings),
      availability,
    ],
    decode(loaded: D1StatementResult[]) {
      const snapshot = agenda.decode(loaded.slice(0, agenda.statements.length));
      if (!snapshot.occurrences.some((item) => item.id === occurrenceId))
        throw new AppError(404, "SESSION_NOT_FOUND", "Session not found.");
      const participationDemand = demandRead
        .decode(loaded.slice(agenda.statements.length, agenda.statements.length + demandRead.statements.length), [
          occurrenceId,
        ])
        .get(occurrenceId)!;
      const offset = agenda.statements.length + demandRead.statements.length;
      const occupancy = batchFirst<{ physical: number; remote: number; unallocated: number }>(loaded[offset]);
      // Attendees and holds share the session's room pool; only operational people are placed in a room.
      const protectedRows = batchRows<{ room_id: string | null }>(loaded[offset + 1]);
      const roomRows = batchRows<{ id: string; occupied: number }>(loaded[offset + 2]);
      const unavailable = decodeStaffingUnavailablePairs(
        batchRows<{ shiftId: string; userId: string }>(loaded[offset + 3]),
      );
      const demand = {
        physical: {
          ...participationDemand.physical,
          occupied: Number(occupancy?.physical ?? 0),
        },
        remote: {
          ...participationDemand.remote,
          occupied: Number(occupancy?.remote ?? 0),
        },
      };
      const physicalDemand = demand.physical.occupied + Number(occupancy?.unallocated ?? 0);
      return roomRecommendationsResponseSchema.parse({
        occurrenceId,
        revision: snapshot.revision,
        demand,
        recommendations: evaluateRoomFits(
          snapshot,
          occurrenceId,
          protectedRows.flatMap((row) => (row.room_id ? [row.room_id] : [])),
          physicalDemand,
          Number(occupancy?.unallocated ?? 0),
          Object.fromEntries(roomRows.map((room) => [room.id, Number(room.occupied)])),
          [...new Set(unavailable.map((pair) => pair.shiftId))],
        ),
      });
    },
  };
}
