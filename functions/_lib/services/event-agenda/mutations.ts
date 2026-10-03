import { assertPublicationCapacity, preparePublicationCapacityGuard } from "./publication-capacity";
import { prepareScopedAuditLog } from "../audit";
import { prepareAgendaChangeNotifications } from "./notifications";
import { z } from "zod";
import {
  agendaOccurrenceCreateSchema,
  agendaOccurrencePatchSchema,
  agendaRoomCreateSchema,
  agendaStaffingSchema,
} from "../../../../assets/shared/schemas/event-agenda";
import { agendaConflicts, allocateAgendaRoles } from "../../../../assets/shared/event-agenda-policy";
import { prepareAuthorizationGuard, isAuthorizationGuardFailure } from "../../db/authorization-guard";
import { first } from "../../db/queries";
import { AppError } from "../../errors";
import type { DatabaseLike, StatementLike } from "../../types";
import { nowIso } from "../../utils/time";
import { getAgenda, getAgendaOccurrence } from "./read";

export async function commitAgendaRevision(
  db: DatabaseLike,
  eventId: string,
  revision: number,
  statements: StatementLike[],
  actorUserId: string | null = null,
) {
  try {
    await db.batch([
      db
        .prepare(
          "INSERT INTO event_agenda_state(event_id,revision,updated_at) VALUES (?,0,?) ON CONFLICT(event_id) DO NOTHING",
        )
        .bind(eventId, nowIso()),
      prepareAuthorizationGuard(db, {
        sql: "SELECT 1 FROM event_agenda_state WHERE event_id = ? AND revision = ?",
        bindings: [eventId, revision],
      }),
      ...statements,
      prepareScopedAuditLog(
        db,
        { type: "event", id: eventId },
        actorUserId ? "user" : "system",
        actorUserId,
        "agenda.revision.updated",
        "event_agenda",
        eventId,
        { fromRevision: revision, toRevision: revision + 1 },
      ),
      db
        .prepare("UPDATE event_agenda_state SET revision=revision+1,updated_at=? WHERE event_id=? AND revision=?")
        .bind(nowIso(), eventId, revision),
    ]);
  } catch (error) {
    if (isAuthorizationGuardFailure(error))
      throw new AppError(
        409,
        "AGENDA_REVISION_CHANGED",
        "Another organizer changed the agenda. Refresh before trying again.",
      );
    throw error;
  }
}
export function agendaSpeakerStatements(db: DatabaseLike, id: string, userIds: string[]) {
  return [
    db.prepare("DELETE FROM event_agenda_occurrence_speakers WHERE occurrence_id=?").bind(id),
    ...userIds.map((userId) =>
      db.prepare("INSERT INTO event_agenda_occurrence_speakers(occurrence_id,user_id) VALUES (?,?)").bind(id, userId),
    ),
  ];
}
export async function createAgendaRoom(
  db: DatabaseLike,
  eventId: string,
  eventSlug: string,
  input: z.infer<typeof agendaRoomCreateSchema>,
  actorUserId: string | null = null,
) {
  await commitAgendaRevision(
    db,
    eventId,
    input.expectedRevision,
    [
      db
        .prepare("INSERT INTO event_agenda_rooms(id,event_id,name,capacity,setup_minutes) VALUES (?,?,?,?,?)")
        .bind(crypto.randomUUID(), eventId, input.name, input.capacity, input.setupMinutes),
    ],
    actorUserId,
  );
  return getAgenda(db, eventId, eventSlug);
}
export async function createAgendaOccurrence(
  db: DatabaseLike,
  eventId: string,
  eventSlug: string,
  input: z.infer<typeof agendaOccurrenceCreateSchema>,
  actorUserId: string | null = null,
) {
  const id = crypto.randomUUID();
  const snapshot = await getAgenda(db, eventId, eventSlug);
  const candidate = { ...input, id, speakers: input.speakerUserIds.map((userId) => ({ userId, displayName: "" })) };
  validateAgendaSchedule(snapshot, [...snapshot.occurrences, candidate]);
  await commitAgendaRevision(
    db,
    eventId,
    input.expectedRevision,
    [
      db
        .prepare(
          "INSERT INTO event_agenda_occurrences(id,event_id,title,description,start_at,end_at,room_id,admission_policy,capacity,remote_capacity,visibility,kind,presentation_url,recording_url) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        )
        .bind(
          id,
          eventId,
          input.title,
          input.description,
          input.startAt,
          input.endAt,
          input.roomId,
          input.admissionPolicy,
          input.capacity,
          input.remoteCapacity,
          input.visibility,
          input.kind,
          input.presentationUrl ?? null,
          input.recordingUrl ?? null,
        ),
      ...agendaSpeakerStatements(db, id, input.speakerUserIds),
    ],
    actorUserId,
  );
  return getAgenda(db, eventId, eventSlug);
}
export function validateAgendaSchedule(
  snapshot: Awaited<ReturnType<typeof getAgenda>>,
  items: typeof snapshot.occurrences,
) {
  const conflicts = agendaConflicts(items, snapshot.travelMinutes, snapshot.rooms);
  for (const item of items) {
    if (item.startAt && snapshot.eventStartsAt && item.startAt < snapshot.eventStartsAt)
      conflicts.push(`${item.title}: session starts before the event`);
    if (item.endAt && snapshot.eventEndsAt && item.endAt > snapshot.eventEndsAt)
      conflicts.push(`${item.title}: session ends after the event`);
    if (Boolean(item.startAt) !== Boolean(item.endAt)) conflicts.push(`${item.title}: both start and end are required`);
    if (item.roomId && !snapshot.rooms.some((room) => room.id === item.roomId))
      conflicts.push(`${item.title}: room does not belong to this event`);
    const room = snapshot.rooms.find((room) => room.id === item.roomId);
    if (
      room?.capacity !== null &&
      room?.capacity !== undefined &&
      item.capacity !== null &&
      item.capacity > room.capacity
    )
      conflicts.push(`${item.title}: session capacity exceeds room capacity`);
  }
  for (const assignment of snapshot.assignments) {
    const block = snapshot.blocks.find((item) => item.id === assignment.blockId);
    if (
      block &&
      items.some(
        (item) =>
          item.startAt &&
          item.endAt &&
          item.startAt < block.endAt &&
          block.startAt < item.endAt &&
          item.speakers.some((speaker) => speaker.userId === assignment.userId),
      )
    )
      conflicts.push("A speaker has an overlapping block duty");
  }
  if (conflicts.length)
    throw new AppError(409, "AGENDA_SCHEDULE_CONFLICT", "This change conflicts with the agenda", { conflicts });
}
export async function patchAgendaOccurrence(
  db: DatabaseLike,
  eventId: string,
  eventSlug: string,
  id: string,
  input: z.infer<typeof agendaOccurrencePatchSchema>,
  actorUserId: string | null = null,
) {
  const snapshot = await getAgenda(db, eventId, eventSlug);
  const existing = await getAgendaOccurrence(db, eventId, id);
  const item = {
    ...existing,
    ...input,
    speakers: input.speakerUserIds?.map((userId) => ({ userId, displayName: "" })) ?? existing.speakers,
  };
  validateAgendaSchedule(
    snapshot,
    snapshot.occurrences.map((current) => (current.id === id ? item : current)),
  );
  const effectiveCapacity = item.capacity ?? snapshot.rooms.find((room) => room.id === item.roomId)?.capacity ?? null;
  if (effectiveCapacity !== null) {
    const bookings = await first<{ total: number }>(
      db,
      "SELECT COUNT(*) AS total FROM (SELECT user_id FROM agenda_session_participations WHERE occurrence_id=? AND attendance_mode='physical' AND status='reserved' UNION SELECT user_id FROM event_session_admissions WHERE occurrence_id=?)",
      [id, id],
    );
    if ((bookings?.total ?? 0) > effectiveCapacity)
      throw new AppError(409, "AGENDA_RESERVED_CAPACITY", "The new capacity would displace confirmed attendees");
  }
  const statements = [
    db
      .prepare(
        "UPDATE event_agenda_occurrences SET title=?,description=?,start_at=?,end_at=?,room_id=?,admission_policy=?,capacity=?,remote_capacity=?,visibility=?,kind=?,presentation_url=?,recording_url=? WHERE id=? AND event_id=?",
      )
      .bind(
        item.title,
        item.description,
        item.startAt,
        item.endAt,
        item.roomId,
        item.admissionPolicy,
        item.capacity,
        item.remoteCapacity,
        item.visibility,
        item.kind,
        item.presentationUrl ?? null,
        item.recordingUrl ?? null,
        id,
        eventId,
      ),
  ];
  if (effectiveCapacity !== null)
    statements.unshift(
      prepareAuthorizationGuard(db, {
        sql: "SELECT 1 WHERE (SELECT COUNT(*) FROM (SELECT user_id FROM agenda_session_participations WHERE occurrence_id=? AND attendance_mode='physical' AND status='reserved' UNION SELECT user_id FROM event_session_admissions WHERE occurrence_id=?)) <= ?",
        bindings: [id, id, effectiveCapacity],
      }),
    );
  if (item.remoteCapacity !== null)
    statements.unshift(
      prepareAuthorizationGuard(db, {
        sql: "SELECT 1 WHERE (SELECT COUNT(*) FROM agenda_session_participations WHERE occurrence_id=? AND attendance_mode='remote' AND status='reserved') <= ?",
        bindings: [id, item.remoteCapacity],
      }),
    );
  if (input.speakerUserIds) statements.push(...agendaSpeakerStatements(db, id, input.speakerUserIds));
  await commitAgendaRevision(db, eventId, input.expectedRevision, statements, actorUserId);
  return getAgenda(db, eventId, eventSlug);
}
export async function swapAgendaOccurrences(
  db: DatabaseLike,
  eventId: string,
  eventSlug: string,
  revision: number,
  firstId: string,
  secondId: string,
  actorUserId: string | null = null,
) {
  const snapshot = await getAgenda(db, eventId, eventSlug);
  const a = await getAgendaOccurrence(db, eventId, firstId);
  const b = await getAgendaOccurrence(db, eventId, secondId);
  const swapped = snapshot.occurrences.map((item) =>
    item.id === a.id
      ? { ...item, startAt: b.startAt, endAt: b.endAt, roomId: b.roomId }
      : item.id === b.id
        ? { ...item, startAt: a.startAt, endAt: a.endAt, roomId: a.roomId }
        : item,
  );
  validateAgendaSchedule(snapshot, swapped);
  await commitAgendaRevision(
    db,
    eventId,
    revision,
    [a, b].flatMap((item, index) => {
      const other = index === 0 ? b : a;
      const capacity = item.capacity ?? snapshot.rooms.find((room) => room.id === other.roomId)?.capacity ?? null;
      const guards =
        capacity === null
          ? []
          : [
              prepareAuthorizationGuard(db, {
                sql: "SELECT 1 WHERE (SELECT COUNT(*) FROM (SELECT user_id FROM agenda_session_participations WHERE occurrence_id=? AND attendance_mode='physical' AND status='reserved' UNION SELECT user_id FROM event_session_admissions WHERE occurrence_id=?)) <= ?",
                bindings: [item.id, item.id, capacity],
              }),
            ];
      return [
        ...guards,
        db
          .prepare("UPDATE event_agenda_occurrences SET start_at=?,end_at=?,room_id=? WHERE id=? AND event_id=?")
          .bind(other.startAt, other.endAt, other.roomId, item.id, eventId),
      ];
    }),
    actorUserId,
  );
  return getAgenda(db, eventId, eventSlug);
}
export async function saveAgendaStaffing(
  db: DatabaseLike,
  eventId: string,
  eventSlug: string,
  input: z.infer<typeof agendaStaffingSchema>,
  actorUserId: string | null = null,
) {
  const snapshot = await getAgenda(db, eventId, eventSlug);
  for (const block of input.blocks) {
    if (block.endAt <= block.startAt) throw new AppError(422, "AGENDA_BLOCK_TIME", "Block end must follow start");
    if (
      (snapshot.eventStartsAt && block.startAt < snapshot.eventStartsAt) ||
      (snapshot.eventEndsAt && block.endAt > snapshot.eventEndsAt)
    )
      throw new AppError(422, "AGENDA_BLOCK_EVENT_BOUNDS", "Staffing block must fit within the event dates");
    if (block.roleRequirements.some((requirement) => !block.roles.includes(requirement.role)))
      throw new AppError(422, "AGENDA_BLOCK_ROLE_REQUIREMENT", "Role requirements must refer to roles in this block");
    if (block.roomId && !snapshot.rooms.some((room) => room.id === block.roomId))
      throw new AppError(422, "AGENDA_BLOCK_ROOM", "Block room is outside this event");
  }
  for (const assignment of input.assignments) {
    const block = input.blocks.find((item) => item.id === assignment.blockId);
    const member = input.roleMembers.find((item) => item.userId === assignment.userId);
    if (!block || !member || !block.roles.includes(assignment.role) || !member.roles.includes(assignment.role))
      throw new AppError(
        422,
        "AGENDA_ASSIGNMENT_INELIGIBLE",
        "Assignment must use an eligible member and required block role",
      );
    if (
      !block.roleRequirements.every(
        (requirement) =>
          requirement.role !== assignment.role ||
          ((requirement.seniority !== "senior" || member.seniority === "senior") &&
            (requirement.attendanceMode === "any" || requirement.attendanceMode === member.attendanceMode)),
      )
    )
      throw new AppError(
        409,
        "AGENDA_ROLE_REQUIREMENTS",
        "Assigned member does not meet this role's seniority or attendance requirements",
      );
    if (
      (member.availableFrom && member.availableFrom > block.startAt) ||
      (member.availableUntil && member.availableUntil < block.endAt)
    )
      throw new AppError(409, "AGENDA_ASSIGNMENT_UNAVAILABLE", "Assigned member is unavailable for this block");
    if (
      snapshot.occurrences.some(
        (item) =>
          item.startAt &&
          item.endAt &&
          item.startAt < block.endAt &&
          block.startAt < item.endAt &&
          item.speakers.some((speaker) => speaker.userId === member.userId),
      )
    )
      throw new AppError(409, "AGENDA_ASSIGNMENT_SPEAKER_CONFLICT", "Assigned member is speaking during this block");
    if (
      input.assignments.some(
        (item) =>
          item !== assignment &&
          item.userId === member.userId &&
          input.blocks.some(
            (other) => other.id === item.blockId && other.startAt < block.endAt && block.startAt < other.endAt,
          ),
      )
    )
      throw new AppError(409, "AGENDA_ASSIGNMENT_OVERLAP", "Assigned member has overlapping duties");
  }
  for (const member of input.roleMembers) {
    const minutes = input.assignments
      .filter((item) => item.userId === member.userId)
      .reduce((sum, assignment) => {
        const block = input.blocks.find((item) => item.id === assignment.blockId);
        return sum + (block ? (Date.parse(block.endAt) - Date.parse(block.startAt)) / 60000 : 0);
      }, 0);
    if (member.maxMinutes !== null && minutes > member.maxMinutes)
      throw new AppError(409, "AGENDA_ASSIGNMENT_WORKLOAD", "Assigned duties exceed the member's maximum workload");
  }
  const statements = [
    db
      .prepare(
        "DELETE FROM event_agenda_assignments WHERE block_id IN(SELECT id FROM event_agenda_blocks WHERE event_id=?)",
      )
      .bind(eventId),
    db.prepare("DELETE FROM event_agenda_blocks WHERE event_id=?").bind(eventId),
    db.prepare("DELETE FROM event_agenda_role_members WHERE event_id=?").bind(eventId),
  ];
  statements.push(
    ...input.blocks.map((block) =>
      db
        .prepare(
          "INSERT INTO event_agenda_blocks(id,event_id,name,start_at,end_at,room_id,roles_json,role_requirements_json) VALUES(?,?,?,?,?,?,?,?)",
        )
        .bind(
          block.id,
          eventId,
          block.name,
          block.startAt,
          block.endAt,
          block.roomId,
          JSON.stringify(block.roles),
          JSON.stringify(block.roleRequirements),
        ),
    ),
  );
  statements.push(
    ...input.roleMembers.map((member) =>
      db
        .prepare(
          "INSERT INTO event_agenda_role_members(event_id,user_id,roles_json,available_from,available_until,max_minutes,seniority,attendance_mode) VALUES(?,?,?,?,?,?,?,?)",
        )
        .bind(
          eventId,
          member.userId,
          JSON.stringify(member.roles),
          member.availableFrom,
          member.availableUntil,
          member.maxMinutes,
          member.seniority,
          member.attendanceMode,
        ),
    ),
  );
  statements.push(
    ...input.assignments.map((assignment) =>
      db
        .prepare("INSERT INTO event_agenda_assignments(block_id,role,user_id,pinned) VALUES(?,?,?,?)")
        .bind(assignment.blockId, assignment.role, assignment.userId, Number(assignment.pinned)),
    ),
  );
  await commitAgendaRevision(db, eventId, input.expectedRevision, statements, actorUserId);
  return getAgenda(db, eventId, eventSlug);
}
export async function allocateStaffing(
  db: DatabaseLike,
  eventId: string,
  eventSlug: string,
  revision: number,
  seed: string,
  strategy: "balanced" | "random",
  actorUserId: string | null = null,
) {
  const snapshot = await getAgenda(db, eventId, eventSlug);
  const result = allocateAgendaRoles(
    snapshot.blocks,
    snapshot.roleMembers,
    snapshot.assignments.filter((assignment) => assignment.pinned),
    snapshot.occurrences,
    seed,
    strategy,
  );
  if (result.uncovered.length)
    throw new AppError(409, "AGENDA_STAFFING_UNCOVERED", "Some duties have no available eligible person", result);
  return saveAgendaStaffing(
    db,
    eventId,
    eventSlug,
    {
      expectedRevision: revision,
      blocks: snapshot.blocks,
      roleMembers: snapshot.roleMembers,
      assignments: result.assignments,
    },
    actorUserId,
  );
}
export async function publishAgenda(
  db: DatabaseLike,
  eventId: string,
  eventSlug: string,
  revision: number,
  userId: string,
) {
  const snapshot = await getAgenda(db, eventId, eventSlug);
  if (snapshot.publishedRevision === snapshot.revision)
    throw new AppError(409, "AGENDA_ALREADY_APPROVED", "This agenda revision is already approved");
  validateAgendaSchedule(snapshot, snapshot.occurrences);
  const nextRevision = revision + 1;
  const approvedSnapshot = {
    ...snapshot,
    revision: nextRevision,
    publishedRevision: nextRevision,
    approvedAt: nowIso(),
    occurrences: snapshot.occurrences.filter((item) => item.startAt && item.endAt),
    roleMembers: [],
    assignments: [],
    blocks: [],
  };
  await assertPublicationCapacity(db, approvedSnapshot);
  const notificationStatements = await prepareAgendaChangeNotifications(db, eventId, nextRevision, approvedSnapshot);
  await commitAgendaRevision(
    db,
    eventId,
    revision,
    [
      preparePublicationCapacityGuard(db, approvedSnapshot),
      ...notificationStatements,
      db
        .prepare(
          "INSERT INTO event_agenda_publications(id,event_id,revision,snapshot_json,created_by,created_at) VALUES(?,?,?,?,?,?)",
        )
        .bind(crypto.randomUUID(), eventId, nextRevision, JSON.stringify(approvedSnapshot), userId, nowIso()),
      db.prepare("UPDATE event_agenda_state SET published_revision=? WHERE event_id=?").bind(nextRevision, eventId),
    ],
    userId,
  );
  return getAgenda(db, eventId, eventSlug);
}

export async function saveAgendaSettings(
  db: DatabaseLike,
  eventId: string,
  eventSlug: string,
  input: { expectedRevision: number; travelMinutes: number },
  actorUserId: string | null = null,
) {
  const snapshot = await getAgenda(db, eventId, eventSlug);
  validateAgendaSchedule({ ...snapshot, travelMinutes: input.travelMinutes }, snapshot.occurrences);
  await commitAgendaRevision(
    db,
    eventId,
    input.expectedRevision,
    [db.prepare("UPDATE event_agenda_state SET travel_minutes=? WHERE event_id=?").bind(input.travelMinutes, eventId)],
    actorUserId,
  );
  return getAgenda(db, eventId, eventSlug);
}
