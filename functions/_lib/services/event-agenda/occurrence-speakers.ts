import type { DatabaseLike } from "../../types";

export function agendaSpeakerStatements(
  db: DatabaseLike,
  id: string,
  userIds: string[],
  roles?: Record<string, string>,
  placements?: Record<string, { attendanceMode: "physical" | "remote"; roomId: string | null }>,
) {
  return [
    ...userIds.map((userId) =>
      db
        .prepare(
          "INSERT INTO event_agenda_occurrence_speakers(occurrence_id,user_id,role,attendance_mode,room_id) VALUES(?,?,COALESCE(?,(SELECT role FROM event_agenda_occurrence_speakers WHERE occurrence_id=? AND user_id=?),'speaker'),COALESCE(?,(SELECT attendance_mode FROM event_agenda_occurrence_speakers WHERE occurrence_id=? AND user_id=?),'physical'),CASE WHEN ? THEN ? ELSE (SELECT room_id FROM event_agenda_occurrence_speakers WHERE occurrence_id=? AND user_id=?) END) ON CONFLICT(occurrence_id,user_id) DO UPDATE SET role=COALESCE(?,role),attendance_mode=COALESCE(?,attendance_mode),room_id=CASE WHEN ? THEN ? ELSE room_id END",
        )
        .bind(
          id,
          userId,
          roles?.[userId] ?? null,
          id,
          userId,
          placements?.[userId]?.attendanceMode ?? null,
          id,
          userId,
          placements?.[userId] ? 1 : 0,
          placements?.[userId]?.roomId ?? null,
          id,
          userId,
          roles?.[userId] ?? null,
          placements?.[userId]?.attendanceMode ?? null,
          placements?.[userId] ? 1 : 0,
          placements?.[userId]?.roomId ?? null,
        ),
    ),
    db
      .prepare(
        "DELETE FROM event_agenda_occurrence_speakers WHERE occurrence_id=? AND user_id NOT IN(SELECT value FROM json_each(?))",
      )
      .bind(id, JSON.stringify(userIds)),
  ];
}
