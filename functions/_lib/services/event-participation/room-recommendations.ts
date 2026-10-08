import { getStaffingUnavailablePairs } from "../event-agenda/staffing-availability";
import { getAgenda } from "../event-agenda/read";
import { evaluateRoomFits } from "../../../../assets/shared/event-agenda-room-fit";
import { roomRecommendationsResponseSchema } from "../../../../assets/shared/schemas/event-room-recommendations";
import { all, first } from "../../db/queries";
import type { DatabaseLike } from "../../types";
import { AppError } from "../../errors";
import {
  physicalAllocatedPeopleSql,
  physicalOccupiedSql,
  physicalRoomOccupiedSql,
  physicallyOccupiedRoomsSql,
  remoteOccupiedSql,
} from "./capacity-accounting";
import { liveOperationalPeopleSql } from "../event-agenda/operational-people";
import { readSessionDemand } from "./session-demand";
export async function roomRecommendations(db: DatabaseLike, eventId: string, eventSlug: string, occurrenceId: string) {
  const snapshot = await getAgenda(db, eventId, eventSlug);
  if (!snapshot.occurrences.some((item) => item.id === occurrenceId))
    throw new AppError(404, "SESSION_NOT_FOUND", "Session not found.");
  const participationDemand = (await readSessionDemand(db, eventId, [occurrenceId])).get(occurrenceId)!;
  const occupancy = await first<{ physical: number; remote: number; unallocated: number }>(
    db,
    `WITH target AS(SELECT ? AS id) SELECT ${physicalOccupiedSql("target.id")} AS physical,${remoteOccupiedSql("target.id")} AS remote,(SELECT COUNT(DISTINCT p.user_id) FROM agenda_session_participations p WHERE p.occurrence_id=target.id AND p.attendance_mode='physical' AND p.status IN('approval_pending','waitlisted') AND NOT EXISTS(SELECT 1 FROM (${physicalAllocatedPeopleSql("target.id")}) allocated WHERE allocated.user_id=p.user_id)) AS unallocated FROM target`,
    [occurrenceId],
  );
  const protectedRows = await all<{ room_id: string | null }>(
    db,
    `WITH target AS(SELECT ? AS id) SELECT room_id FROM (${physicallyOccupiedRoomsSql("(SELECT id FROM target)")}) held CROSS JOIN target UNION SELECT person.room_id FROM (${liveOperationalPeopleSql}) person WHERE person.occurrence_id=? AND person.attendance_mode='physical' LIMIT 200`,
    [occurrenceId, occurrenceId],
  );
  const roomRows = await all<{ id: string; occupied: number }>(
    db,
    `WITH target AS(SELECT ? AS id) SELECT room.id,${physicalRoomOccupiedSql("target.id", "room.id")} AS occupied FROM event_agenda_rooms room CROSS JOIN target WHERE room.event_id=? LIMIT 200`,
    [occurrenceId, eventId],
  );
  const session = snapshot.occurrences.find((item) => item.id === occurrenceId)!;
  const candidateShifts =
    session.startAt && session.endAt
      ? snapshot.rooms.map((room) => ({
          id: room.id,
          name: room.name,
          startAt: session.startAt!,
          endAt: session.endAt!,
          roomId: room.id,
          roles: ["speaker"],
          roleRequirements: [],
        }))
      : [];
  const crossSnapshot = {
    ...snapshot,
    shifts: candidateShifts,
    staffingPosts: [],
    staffingRequirements: candidateShifts.map((shift) => ({
      id: shift.id,
      shiftId: shift.id,
      roleId: "speaker",
      postId: null,
      idealCount: 1,
      seniority: "any" as const,
      attendanceMode: "any" as const,
    })),
    staffingPositions: candidateShifts.map((shift) => ({ id: shift.id, requirementId: shift.id, index: 1 })),
    roleMembers: session.speakers.map((person) => ({
      userId: person.userId,
      displayName: person.displayName,
      roles: ["speaker"],
      availableFrom: null,
      availableUntil: null,
      maxMinutes: null,
      seniority: "junior" as const,
      attendanceMode: person.attendanceMode ?? ("physical" as const),
    })),
  };
  const unavailable = await getStaffingUnavailablePairs(db, eventId, crossSnapshot);
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
}
