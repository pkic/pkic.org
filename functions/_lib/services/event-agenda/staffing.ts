import {
  allocateAgendaStaffingPositions,
  validateAgendaStaffingPositionAssignments,
} from "../../../../assets/shared/event-agenda-staffing-positions";
import { agendaStaffingPositionPlanSchema } from "../../../../assets/shared/schemas/event-agenda-staffing-positions";
import { getStaffingUnavailablePairs } from "./staffing-availability";
import { z } from "zod";
import { agendaStaffingSchema } from "../../../../assets/shared/schemas/event-agenda";
import { agendaRoomIsAvailable } from "../../../../assets/shared/event-agenda-policy";
import { prepareScopedAuditLog } from "../audit";
import { AppError } from "../../errors";
import type { DatabaseLike } from "../../types";
import { getAgenda } from "./read";
import { commitAgendaRevision } from "./revision";

export async function saveAgendaStaffing(
  db: DatabaseLike,
  eventId: string,
  eventSlug: string,
  input: z.infer<typeof agendaStaffingSchema>,
  actorUserId: string | null = null,
  generation?: {
    seed: string;
    strategy: "balanced" | "random";
    selectedShiftIds?: string[];
    unavailablePairs?: Array<{ shiftId: string; userId: string }>;
    uncovered?: ReturnType<typeof allocateAgendaStaffingPositions>["uncovered"];
  },
) {
  const validated = agendaStaffingSchema.safeParse(input);
  if (!validated.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of validated.error.issues) (fieldErrors[issue.path.join(".")] ??= []).push(issue.message);
    throw new AppError(400, "VALIDATION_ERROR", "Check the staffing fields", { fieldErrors });
  }
  input = validated.data;
  const snapshot = await getAgenda(db, eventId, eventSlug);
  input = {
    ...input,
    shifts: input.shifts.map((shift) => ({
      ...shift,
      roles: [
        ...new Set(
          input.staffingRequirements
            .filter((requirement) => requirement.shiftId === shift.id)
            .map((requirement) => requirement.roleId),
        ),
      ],
      roleRequirements: [],
    })),
  };
  for (const shift of input.shifts) {
    const room = snapshot.rooms.find((candidate) => candidate.id === shift.roomId);
    if (room && !agendaRoomIsAvailable(room, shift.startAt, shift.endAt, false))
      throw new AppError(409, "AGENDA_ROOM_UNAVAILABLE", "Location is unavailable for this staffing shift");
    if (shift.endAt <= shift.startAt) throw new AppError(422, "AGENDA_SHIFT_TIME", "Shift end must follow start");
    if (
      (snapshot.eventStartsAt && shift.startAt < snapshot.eventStartsAt) ||
      (snapshot.eventEndsAt && shift.endAt > snapshot.eventEndsAt)
    )
      throw new AppError(422, "AGENDA_SHIFT_EVENT_BOUNDS", "Staffing shift must fit within the event dates");
    if (
      (shift.compatibleRolePairs ?? []).some(
        ([first, second]) => first === second || !shift.roles.includes(first) || !shift.roles.includes(second),
      )
    )
      throw new AppError(
        422,
        "AGENDA_ROLE_COMPATIBILITY",
        "Compatible duties must be distinct roles in the same shift",
      );
    for (const occurrenceId of [shift.boundaries?.startOccurrenceId, shift.boundaries?.endOccurrenceId])
      if (
        occurrenceId &&
        !snapshot.occurrences.some((occurrence) => occurrence.id === occurrenceId && occurrence.kind === "break")
      )
        throw new AppError(422, "AGENDA_SHIFT_BOUNDARY", "Shift boundaries must refer to breaks in this event");
    if (shift.roleRequirements.some((requirement) => !shift.roles.includes(requirement.role)))
      throw new AppError(422, "AGENDA_SHIFT_ROLE_REQUIREMENT", "Role requirements must refer to roles in this shift");
    if (shift.roomId && !snapshot.rooms.some((room) => room.id === shift.roomId))
      throw new AppError(422, "AGENDA_SHIFT_ROOM", "Shift room is outside this event");
    if (shift.track && !snapshot.occurrences.some((occurrence) => occurrence.track === shift.track))
      throw new AppError(422, "AGENDA_SHIFT_TRACK", "Choose an authored track in this event");
  }
  const plan = agendaStaffingPositionPlanSchema.parse({
    roles: input.staffingRoles,
    posts: input.staffingPosts,
    requirements: input.staffingRequirements,
    positions: input.staffingPositions,
    assignments: input.assignments,
  });
  if (
    plan.requirements.some((requirement) => !input.shifts.some((shift) => shift.id === requirement.shiftId)) ||
    plan.posts.some((post) => post.roomId && !snapshot.rooms.some((room) => room.id === post.roomId)) ||
    input.roleMembers.some((member) =>
      member.roles.some((role) => !plan.roles.some((candidate) => candidate.id === role)),
    )
  )
    throw new AppError(422, "AGENDA_STAFFING_SCOPE", "Choose roles, posts and shifts within this event");
  for (const requirement of plan.requirements) {
    const shift = input.shifts.find((candidate) => candidate.id === requirement.shiftId)!;
    const post = plan.posts.find((candidate) => candidate.id === requirement.postId);
    const room = snapshot.rooms.find((candidate) => candidate.id === (post ? post.roomId : shift.roomId));
    if (room && !agendaRoomIsAvailable(room, shift.startAt, shift.endAt, false))
      throw new AppError(409, "AGENDA_ROOM_UNAVAILABLE", "Staffing post location is unavailable for this shift");
  }
  if (plan.assignments.some((assignment) => !input.roleMembers.some((member) => member.userId === assignment.userId)))
    throw new AppError(422, "AGENDA_ASSIGNMENT_INELIGIBLE", "Choose a person from the staffing roster");
  const invalid = validateAgendaStaffingPositionAssignments({
    ...plan,
    shifts: input.shifts,
    members: input.roleMembers,
    occurrences: snapshot.occurrences,
    travelMinutes: snapshot.travelMinutes,
  });
  if (invalid.length) {
    const reasons = invalid.flatMap((item) => item.reasons);
    throw new AppError(
      409,
      reasons.includes("workload")
        ? "AGENDA_ASSIGNMENT_WORKLOAD"
        : reasons.includes("conflict")
          ? "AGENDA_ASSIGNMENT_OVERLAP"
          : "AGENDA_ASSIGNMENT_CONFLICT",
      "Assigned member cannot cover the complete position",
      { assignments: invalid },
    );
  }
  const statements = [
    db
      .prepare(
        "DELETE FROM event_agenda_assignments WHERE shift_id IN(SELECT id FROM event_agenda_shifts WHERE event_id=?)",
      )
      .bind(eventId),
    db.prepare("DELETE FROM event_agenda_staffing_positions WHERE event_id=?").bind(eventId),
    db.prepare("DELETE FROM event_agenda_staffing_requirements WHERE event_id=?").bind(eventId),
    db.prepare("DELETE FROM event_agenda_staffing_posts WHERE event_id=?").bind(eventId),
    db.prepare("DELETE FROM event_agenda_staffing_roles WHERE event_id=?").bind(eventId),
    db.prepare("DELETE FROM event_agenda_shifts WHERE event_id=?").bind(eventId),
    db.prepare("DELETE FROM event_agenda_role_members WHERE event_id=?").bind(eventId),
  ];
  statements.push(
    ...input.shifts.map((shift) =>
      db
        .prepare(
          "INSERT INTO event_agenda_shifts(id,event_id,name,start_at,end_at,room_id,track,roles_json,role_requirements_json,compatible_roles_json,boundaries_json) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
        )
        .bind(
          shift.id,
          eventId,
          shift.name,
          shift.startAt,
          shift.endAt,
          shift.roomId,
          shift.track ?? null,
          JSON.stringify(shift.roles),
          JSON.stringify(shift.roleRequirements),
          JSON.stringify(shift.compatibleRolePairs ?? []),
          JSON.stringify(shift.boundaries ?? {}),
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
    ...plan.roles.map((role) =>
      db
        .prepare("INSERT INTO event_agenda_staffing_roles(event_id,id,name,show_on_agenda) VALUES(?,?,?,?)")
        .bind(eventId, role.id, role.name, Number(role.showOnAgenda)),
    ),
    ...plan.posts.map((post) =>
      db
        .prepare("INSERT INTO event_agenda_staffing_posts(event_id,id,name,room_id) VALUES(?,?,?,?)")
        .bind(eventId, post.id, post.name, post.roomId),
    ),
    ...plan.requirements.map((requirement) =>
      db
        .prepare(
          "INSERT INTO event_agenda_staffing_requirements(event_id,id,shift_id,role_id,post_id,ideal_count,seniority,attendance_mode) VALUES(?,?,?,?,?,?,?,?)",
        )
        .bind(
          eventId,
          requirement.id,
          requirement.shiftId,
          requirement.roleId,
          requirement.postId,
          requirement.idealCount,
          requirement.seniority,
          requirement.attendanceMode,
        ),
    ),
    ...plan.positions.map((position) =>
      db
        .prepare(
          "INSERT INTO event_agenda_staffing_positions(event_id,id,requirement_id,position_index) VALUES(?,?,?,?)",
        )
        .bind(eventId, position.id, position.requirementId, position.index),
    ),
  );
  statements.push(
    ...input.assignments.map((assignment) =>
      db
        .prepare(
          "INSERT INTO event_agenda_assignments(event_id,position_id,shift_id,role,post_id,user_id,pinned,origin) VALUES(?,?,?,?,?,?,?,?)",
        )
        .bind(
          eventId,
          assignment.positionId,
          assignment.shiftId,
          assignment.role,
          assignment.postId,
          assignment.userId,
          Number(assignment.pinned),
          assignment.origin ?? "manual",
        ),
    ),
  );
  if (generation)
    statements.push(
      prepareScopedAuditLog(
        db,
        { type: "event", id: eventId },
        actorUserId ? "user" : "system",
        actorUserId,
        "agenda.staffing.generated",
        "event_agenda",
        eventId,
        {
          ...generation,
          staffingRoles: plan.roles,
          staffingPosts: plan.posts,
          staffingRequirements: plan.requirements,
          staffingPositions: plan.positions,
          fromRevision: input.expectedRevision,
          toRevision: input.expectedRevision + 1,
          travelMinutes: snapshot.travelMinutes,
          shifts: input.shifts.map(
            ({ id, startAt, endAt, roomId, track, roles, roleRequirements, compatibleRolePairs, boundaries }) => ({
              id,
              startAt,
              endAt,
              roomId,
              track,
              roles,
              roleRequirements,
              compatibleRolePairs,
              boundaries,
            }),
          ),
          eligiblePeople: input.roleMembers.map(
            ({ userId, roles, availableFrom, availableUntil, maxMinutes, seniority, attendanceMode }) => ({
              userId,
              roles,
              availableFrom,
              availableUntil,
              maxMinutes,
              seniority,
              attendanceMode,
            }),
          ),
          speakingIntervals: snapshot.occurrences
            .filter((occurrence) => occurrence.startAt && occurrence.endAt)
            .map(({ id, startAt, endAt, roomId, speakers }) => ({
              id,
              startAt,
              endAt,
              roomId,
              speakers: speakers.map(({ userId, attendanceMode, roomId }) => ({ userId, attendanceMode, roomId })),
            })),
          assignments: input.assignments,
        },
      ),
    );
  try {
    await commitAgendaRevision(db, eventId, input.expectedRevision, statements, actorUserId);
  } catch (error) {
    const constraint =
      error instanceof Error &&
      /UNIQUE constraint failed: (event_agenda_staffing_(roles|posts))\.event_id, \1\.name(?:\s|:|$)/.exec(
        error.message,
      );
    if (!constraint) throw error;
    const field = constraint[2] === "roles" ? "staffingRoles" : "staffingPosts";
    const conflicts = await db
      .prepare(
        `SELECT incoming.key AS row_index FROM json_each(?) incoming
       JOIN ${constraint[1]} stored ON stored.event_id=?
       AND stored.name=json_extract(incoming.value,'$.name')
       AND stored.id<>json_extract(incoming.value,'$.id')`,
      )
      .bind(JSON.stringify(input[field]), eventId)
      .all<{ row_index: number }>();
    const message = `Choose a unique ${field === "staffingRoles" ? "role" : "post"} name within this event`;
    const fieldErrors = Object.fromEntries(
      (conflicts.results ?? []).map(({ row_index }) => [`${field}.${row_index}.name`, [message]]),
    );
    throw new AppError(409, "AGENDA_STAFFING_NAME_CONFLICT", message, {
      fieldErrors,
      formErrors: Object.keys(fieldErrors).length ? [] : [message],
    });
  }
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
  selectedShiftIds?: string[],
) {
  const snapshot = await getAgenda(db, eventId, eventSlug);
  const selected = selectedShiftIds ? new Set(selectedShiftIds) : null;
  if (
    selected &&
    (selected.size === 0 || [...selected].some((id) => !snapshot.shifts.some((shift) => shift.id === id)))
  )
    throw new AppError(400, "AGENDA_ALLOCATION_SHIFT_UNKNOWN", "Choose existing staffing shifts");
  const preserved = snapshot.assignments.filter((assignment) => selected && !selected.has(assignment.shiftId));
  const unavailablePairs = await getStaffingUnavailablePairs(db, eventId, snapshot);
  const result = allocateAgendaStaffingPositions({
    roles: snapshot.staffingRoles,
    posts: snapshot.staffingPosts,
    requirements: snapshot.staffingRequirements,
    positions: snapshot.staffingPositions,
    shifts: snapshot.shifts,
    members: snapshot.roleMembers,
    occurrences: snapshot.occurrences,
    assignments: [
      ...snapshot.assignments.filter(
        (assignment) => assignment.pinned && (!selected || selected.has(assignment.shiftId)),
      ),
      ...preserved.map((assignment) => ({ ...assignment, pinned: true })),
    ],
    seed,
    strategy,
    selectedShiftIds: selected ?? undefined,
    travelMinutes: snapshot.travelMinutes,
    unavailablePairs: new Set(unavailablePairs.map(({ shiftId, userId }) => JSON.stringify([shiftId, userId]))),
  });
  return saveAgendaStaffing(
    db,
    eventId,
    eventSlug,
    {
      expectedRevision: revision,
      shifts: snapshot.shifts,
      roleMembers: snapshot.roleMembers,
      staffingRoles: snapshot.staffingRoles,
      staffingPosts: snapshot.staffingPosts,
      staffingRequirements: snapshot.staffingRequirements,
      staffingPositions: snapshot.staffingPositions,
      assignments: result.assignments.map(
        (assignment) => preserved.find((original) => original.positionId === assignment.positionId) ?? assignment,
      ),
    },
    actorUserId,
    { seed, strategy, selectedShiftIds, unavailablePairs, uncovered: result.uncovered },
  );
}
