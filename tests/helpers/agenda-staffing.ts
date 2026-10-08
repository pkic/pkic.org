import type { DatabaseLike } from "../../functions/_lib/types";
import { z } from "zod";
import {
  agendaStaffingSchema,
  agendaShiftSchema,
  agendaRoleMemberSchema,
  agendaAssignmentSchema,
} from "../../assets/shared/schemas/event-agenda";
/** Single-person fixture convenience; production never synthesizes missing position resources. */
export function staffingFixture(input: {
  expectedRevision: number;
  shifts: Array<z.input<typeof agendaShiftSchema>>;
  roleMembers: Array<z.input<typeof agendaRoleMemberSchema>>;
  assignments?: Array<Omit<z.input<typeof agendaAssignmentSchema>, "positionId" | "postId">>;
}) {
  const requirements = input.shifts.flatMap((shift) =>
    shift.roles.map((role) => ({
      id: `${shift.id}:${role}:requirement`,
      shiftId: shift.id,
      roleId: role,
      postId: null,
      idealCount: 1,
      seniority: shift.roleRequirements?.find((requirement) => requirement.role === role)?.seniority ?? "any",
      attendanceMode: shift.roleRequirements?.find((requirement) => requirement.role === role)?.attendanceMode ?? "any",
    })),
  );
  return agendaStaffingSchema.parse({
    ...input,
    staffingRoles: [
      ...new Set(
        input.roleMembers.flatMap((member) => member.roles).concat(input.shifts.flatMap((shift) => shift.roles)),
      ),
    ].map((id) => ({ id, name: id })),
    staffingPosts: [],
    staffingRequirements: requirements,
    staffingPositions: requirements.map((requirement) => ({
      id: `${requirement.shiftId}:${requirement.roleId}:position`,
      requirementId: requirement.id,
      index: 1,
    })),
    assignments: (input.assignments ?? []).map((assignment) => ({
      ...assignment,
      positionId: `${assignment.shiftId}:${assignment.role}:position`,
      postId: null,
    })),
  });
}

/** Seed normalized position resources for conflict read-model fixtures, which intentionally bypass schedule commands. */
export async function seedStaffingPositionAssignment(
  db: DatabaseLike,
  input: {
    eventId: string;
    shiftId: string;
    role: string;
    userId: string;
    pinned?: boolean;
  },
) {
  const requirementId = `${input.shiftId}:${input.role}:requirement`;
  const positionId = `${input.shiftId}:${input.role}:position`;
  await db.batch([
    db
      .prepare(
        "INSERT INTO event_agenda_staffing_roles(event_id,id,name,show_on_agenda) VALUES(?,?,?,0) ON CONFLICT(event_id,id) DO NOTHING",
      )
      .bind(input.eventId, input.role, input.role),
    db
      .prepare(
        "INSERT INTO event_agenda_staffing_requirements(event_id,id,shift_id,role_id,post_id,ideal_count,seniority,attendance_mode) VALUES(?,?,?,?,NULL,1,'any','any')",
      )
      .bind(input.eventId, requirementId, input.shiftId, input.role),
    db
      .prepare("INSERT INTO event_agenda_staffing_positions(event_id,id,requirement_id,position_index) VALUES(?,?,?,1)")
      .bind(input.eventId, positionId, requirementId),
    db
      .prepare(
        "INSERT INTO event_agenda_assignments(event_id,position_id,shift_id,role,post_id,user_id,pinned,origin) VALUES(?,?,?,?,NULL,?,?,'manual')",
      )
      .bind(input.eventId, positionId, input.shiftId, input.role, input.userId, Number(input.pinned ?? false)),
  ]);
}
