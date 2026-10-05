import { agendaStaffingBlockAppliesToOccurrence } from "../../../../assets/shared/event-agenda-staffing-scope";
import type { AgendaSnapshot } from "../../../../assets/shared/schemas/event-agenda";
import { agendaOccurrenceRoomIds } from "../../../../assets/shared/event-agenda-rooms";
import { AppError } from "../../errors";
import type { DatabaseLike } from "../../types";
export interface OperationalPerson {
  occurrence_id: string;
  user_id: string;
  attendance_mode: "physical" | "remote";
  room_id: string | null;
  sources: string[];
}
/** A canonical person occupies one mode/location; a credit and an MC assignment never add two seats. */
export function operationalPeople(snapshot: AgendaSnapshot): OperationalPerson[] {
  const people = new Map<string, OperationalPerson>();
  for (const session of snapshot.occurrences) {
    if (!session.startAt || !session.endAt) continue;
    const rooms = agendaOccurrenceRoomIds(session);
    const add = (
      userId: string,
      mode: "physical" | "remote",
      requestedRoom: string | null | undefined,
      source: string,
    ) => {
      if (mode === "physical" && rooms.length > 1 && !requestedRoom)
        throw new AppError(
          409,
          "AGENDA_PERSON_ROOM_REQUIRED",
          `Choose one physical location for each presenter and staff member in “${session.title}”.`,
        );
      const room = mode === "remote" ? null : (requestedRoom ?? session.roomId);
      if (mode === "physical" && room && !rooms.includes(room))
        throw new AppError(
          409,
          "AGENDA_PERSON_ROOM_INVALID",
          `A presenter or staff location is outside “${session.title}”.`,
        );
      const key = `${session.id}:${userId}`;
      const prior = people.get(key);
      if (prior && (prior.attendance_mode !== mode || prior.room_id !== room))
        throw new AppError(
          409,
          "AGENDA_PERSON_ALLOCATION_CONFLICT",
          `A person has conflicting attendance modes or locations in “${session.title}”.`,
        );
      if (prior) prior.sources.push(source);
      else
        people.set(key, {
          occurrence_id: session.id,
          user_id: userId,
          attendance_mode: mode,
          room_id: room,
          sources: [source],
        });
    };
    for (const speaker of session.speakers)
      if (speaker.role !== "proposer")
        add(
          speaker.userId,
          speaker.attendanceMode ?? "physical",
          speaker.roomId,
          `credit:${speaker.role ?? "speaker"}`,
        );
    for (const block of snapshot.blocks) {
      if (!agendaStaffingBlockAppliesToOccurrence(block, session)) continue;

      for (const assignment of snapshot.assignments.filter((item) => item.blockId === block.id)) {
        const member = snapshot.roleMembers.find((item) => item.userId === assignment.userId);
        if (!member)
          throw new AppError(409, "AGENDA_STAFF_MEMBER_MISSING", "An assigned staff member has no attendance mode.");
        const post = snapshot.staffingPosts.find((candidate) => candidate.id === assignment.postId);
        const roomId = post ? post.roomId : block.roomId;
        if (roomId && !rooms.includes(roomId)) continue;
        add(member.userId, member.attendanceMode, roomId, `position:${assignment.positionId}:${assignment.role}`);
      }
    }
  }
  return [...people.values()];
}
export function prepareOperationalPeople(
  db: DatabaseLike,
  eventId: string,
  revision: number,
  people: OperationalPerson[],
) {
  return db
    .prepare(
      "INSERT INTO event_agenda_operational_people(event_id,revision,occurrence_id,user_id,attendance_mode,room_id,sources_json) SELECT ?,?,json_extract(value,'$.occurrence_id'),json_extract(value,'$.user_id'),json_extract(value,'$.attendance_mode'),json_extract(value,'$.room_id'),json_extract(value,'$.sources') FROM json_each(?)",
    )
    .bind(eventId, revision, JSON.stringify(people));
}
/** Caller-provided CTE can replace live authority while validating a proposed publication. */
export const liveOperationalPeopleSql =
  "SELECT person.occurrence_id,person.user_id,person.attendance_mode,person.room_id FROM event_agenda_operational_people person JOIN event_agenda_state state ON state.event_id=person.event_id AND state.published_revision=person.revision";
