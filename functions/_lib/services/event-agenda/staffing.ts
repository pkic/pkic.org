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
    selectedBlockIds?: string[];
    unavailablePairs?: Array<{ blockId: string; userId: string }>;
    uncovered?: ReturnType<typeof allocateAgendaStaffingPositions>["uncovered"];
  },
) {
  const snapshot = await getAgenda(db, eventId, eventSlug);
  input = {
    ...input,
    blocks: input.blocks.map((block) => ({
      ...block,
      roles: [
        ...new Set(
          input.staffingRequirements
            .filter((requirement) => requirement.blockId === block.id)
            .map((requirement) => requirement.roleId),
        ),
      ],
      roleRequirements: [],
    })),
  };
  for (const block of input.blocks) {
    const room = snapshot.rooms.find((candidate) => candidate.id === block.roomId);
    if (room && !agendaRoomIsAvailable(room, block.startAt, block.endAt, false))
      throw new AppError(409, "AGENDA_ROOM_UNAVAILABLE", "Location is unavailable for this staffing block");
    if (block.endAt <= block.startAt) throw new AppError(422, "AGENDA_BLOCK_TIME", "Block end must follow start");
    if (
      (snapshot.eventStartsAt && block.startAt < snapshot.eventStartsAt) ||
      (snapshot.eventEndsAt && block.endAt > snapshot.eventEndsAt)
    )
      throw new AppError(422, "AGENDA_BLOCK_EVENT_BOUNDS", "Staffing block must fit within the event dates");
    if (
      (block.compatibleRolePairs ?? []).some(
        ([first, second]) => first === second || !block.roles.includes(first) || !block.roles.includes(second),
      )
    )
      throw new AppError(
        422,
        "AGENDA_ROLE_COMPATIBILITY",
        "Compatible duties must be distinct roles in the same block",
      );
    for (const occurrenceId of [block.boundaries?.startOccurrenceId, block.boundaries?.endOccurrenceId])
      if (
        occurrenceId &&
        !snapshot.occurrences.some((occurrence) => occurrence.id === occurrenceId && occurrence.kind === "break")
      )
        throw new AppError(422, "AGENDA_BLOCK_BOUNDARY", "Block boundaries must refer to breaks in this event");
    if (block.roleRequirements.some((requirement) => !block.roles.includes(requirement.role)))
      throw new AppError(422, "AGENDA_BLOCK_ROLE_REQUIREMENT", "Role requirements must refer to roles in this block");
    if (block.roomId && !snapshot.rooms.some((room) => room.id === block.roomId))
      throw new AppError(422, "AGENDA_BLOCK_ROOM", "Block room is outside this event");
    if (block.track && !snapshot.occurrences.some((occurrence) => occurrence.track === block.track))
      throw new AppError(422, "AGENDA_BLOCK_TRACK", "Choose an authored track in this event");
  }
  const plan = agendaStaffingPositionPlanSchema.parse({
    roles: input.staffingRoles,
    posts: input.staffingPosts,
    requirements: input.staffingRequirements,
    positions: input.staffingPositions,
    assignments: input.assignments,
  });
  if (
    plan.requirements.some((requirement) => !input.blocks.some((block) => block.id === requirement.blockId)) ||
    plan.posts.some((post) => post.roomId && !snapshot.rooms.some((room) => room.id === post.roomId)) ||
    input.roleMembers.some((member) =>
      member.roles.some((role) => !plan.roles.some((candidate) => candidate.id === role)),
    )
  )
    throw new AppError(422, "AGENDA_STAFFING_SCOPE", "Choose roles, posts and blocks within this event");
  for (const requirement of plan.requirements) {
    const block = input.blocks.find((candidate) => candidate.id === requirement.blockId)!;
    const post = plan.posts.find((candidate) => candidate.id === requirement.postId);
    const room = snapshot.rooms.find((candidate) => candidate.id === (post ? post.roomId : block.roomId));
    if (room && !agendaRoomIsAvailable(room, block.startAt, block.endAt, false))
      throw new AppError(409, "AGENDA_ROOM_UNAVAILABLE", "Staffing post location is unavailable for this block");
  }
  if (plan.assignments.some((assignment) => !input.roleMembers.some((member) => member.userId === assignment.userId)))
    throw new AppError(422, "AGENDA_ASSIGNMENT_INELIGIBLE", "Choose a person from the staffing roster");
  const invalid = validateAgendaStaffingPositionAssignments({
    ...plan,
    blocks: input.blocks,
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
        "DELETE FROM event_agenda_assignments WHERE block_id IN(SELECT id FROM event_agenda_blocks WHERE event_id=?)",
      )
      .bind(eventId),
    db.prepare("DELETE FROM event_agenda_staffing_positions WHERE event_id=?").bind(eventId),
    db.prepare("DELETE FROM event_agenda_staffing_requirements WHERE event_id=?").bind(eventId),
    db.prepare("DELETE FROM event_agenda_staffing_posts WHERE event_id=?").bind(eventId),
    db.prepare("DELETE FROM event_agenda_staffing_roles WHERE event_id=?").bind(eventId),
    db.prepare("DELETE FROM event_agenda_blocks WHERE event_id=?").bind(eventId),
    db.prepare("DELETE FROM event_agenda_role_members WHERE event_id=?").bind(eventId),
  ];
  statements.push(
    ...input.blocks.map((block) =>
      db
        .prepare(
          "INSERT INTO event_agenda_blocks(id,event_id,name,start_at,end_at,room_id,track,roles_json,role_requirements_json,compatible_roles_json,boundaries_json) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
        )
        .bind(
          block.id,
          eventId,
          block.name,
          block.startAt,
          block.endAt,
          block.roomId,
          block.track ?? null,
          JSON.stringify(block.roles),
          JSON.stringify(block.roleRequirements),
          JSON.stringify(block.compatibleRolePairs ?? []),
          JSON.stringify(block.boundaries ?? {}),
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
          "INSERT INTO event_agenda_staffing_requirements(event_id,id,block_id,role_id,post_id,ideal_count,seniority,attendance_mode) VALUES(?,?,?,?,?,?,?,?)",
        )
        .bind(
          eventId,
          requirement.id,
          requirement.blockId,
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
          "INSERT INTO event_agenda_assignments(event_id,position_id,block_id,role,post_id,user_id,pinned,origin) VALUES(?,?,?,?,?,?,?,?)",
        )
        .bind(
          eventId,
          assignment.positionId,
          assignment.blockId,
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
          blocks: input.blocks.map(
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
  selectedBlockIds?: string[],
) {
  const snapshot = await getAgenda(db, eventId, eventSlug);
  const selected = selectedBlockIds ? new Set(selectedBlockIds) : null;
  if (
    selected &&
    (selected.size === 0 || [...selected].some((id) => !snapshot.blocks.some((block) => block.id === id)))
  )
    throw new AppError(400, "AGENDA_ALLOCATION_BLOCK_UNKNOWN", "Choose existing staffing blocks");
  const preserved = snapshot.assignments.filter((assignment) => selected && !selected.has(assignment.blockId));
  const unavailablePairs = await getStaffingUnavailablePairs(db, eventId, snapshot);
  const result = allocateAgendaStaffingPositions({
    roles: snapshot.staffingRoles,
    posts: snapshot.staffingPosts,
    requirements: snapshot.staffingRequirements,
    positions: snapshot.staffingPositions,
    blocks: snapshot.blocks,
    members: snapshot.roleMembers,
    occurrences: snapshot.occurrences,
    assignments: [
      ...snapshot.assignments.filter(
        (assignment) => assignment.pinned && (!selected || selected.has(assignment.blockId)),
      ),
      ...preserved.map((assignment) => ({ ...assignment, pinned: true })),
    ],
    seed,
    strategy,
    selectedBlockIds: selected ?? undefined,
    travelMinutes: snapshot.travelMinutes,
    unavailablePairs: new Set(unavailablePairs.map(({ blockId, userId }) => JSON.stringify([blockId, userId]))),
  });
  return saveAgendaStaffing(
    db,
    eventId,
    eventSlug,
    {
      expectedRevision: revision,
      blocks: snapshot.blocks,
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
    { seed, strategy, selectedBlockIds, unavailablePairs, uncovered: result.uncovered },
  );
}
