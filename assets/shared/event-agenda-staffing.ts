import type {
  AgendaAssignment,
  AgendaShift,
  AgendaRoleMember,
  AgendaOccurrence,
  AgendaSnapshot,
} from "./schemas/event-agenda";
export {
  agendaStaffingReasonLabels,
  agendaDutiesCompatible,
  agendaStaffingEligibility,
  agendaShiftMinutes,
} from "./event-agenda-staffing-eligibility";
import { agendaShiftMinutes } from "./event-agenda-staffing-eligibility";
import {
  allocateAgendaStaffingPositions,
  agendaStaffingPositionCoverage,
  agendaStaffingPositionShortfalls,
} from "./event-agenda-staffing-positions";
import type { AgendaStaffingPositionPlan } from "./schemas/event-agenda-staffing-positions";
/** Duration and role balance stay inside eligible pools. Consecutive duty is a soft preference. */
export function allocateAgendaRoles(
  shifts: AgendaShift[],
  members: AgendaRoleMember[],
  pinned: Omit<AgendaAssignment, "positionId" | "postId">[],
  occurrences: AgendaOccurrence[],
  seed: string,
  strategy: "balanced" | "random",
  selectedShiftIds?: ReadonlySet<string>,
  travelMinutes = 0,
  unavailablePairs: ReadonlySet<string> = new Set(),
) {
  const requirements = shifts.flatMap((shift, shiftIndex) =>
    shift.roles.map((role, roleIndex) => ({
      id: `legacy-${shiftIndex}-${roleIndex}`,
      shiftId: shift.id,
      roleId: role,
      postId: null,
      idealCount: 1,
      seniority: shift.roleRequirements.find((r) => r.role === role)?.seniority ?? "any",
      attendanceMode: shift.roleRequirements.find((r) => r.role === role)?.attendanceMode ?? "any",
    })),
  );
  const positions = requirements.map((requirement) => ({
    id: requirement.id,
    requirementId: requirement.id,
    index: 1,
  }));
  const result = allocateAgendaStaffingPositions({
    shifts,
    members,
    requirements,
    positions,
    posts: [],
    occurrences,
    seed,
    strategy,
    selectedShiftIds,
    travelMinutes,
    roles: [...new Set(shifts.flatMap((shift) => shift.roles))].map((role) => ({
      id: role,
      name: role,
      showOnAgenda: false,
    })),
    assignments: pinned.map((assignment) => ({
      ...assignment,
      postId: null,
      positionId: requirements.find((r) => r.shiftId === assignment.shiftId && r.roleId === assignment.role)!.id,
    })),
    unavailablePairs: new Set(
      requirements.flatMap((r) =>
        members
          .filter((m) => unavailablePairs.has(JSON.stringify([r.shiftId, m.userId])))
          .map((m) => JSON.stringify([r.id, m.userId])),
      ),
    ),
  });
  return {
    assignments: result.assignments.map((assignment) => {
      const requirement = requirements.find((r) => r.id === assignment.positionId)!;
      return {
        shiftId: requirement.shiftId,
        role: requirement.roleId,
        userId: assignment.userId,
        pinned: assignment.pinned,
        origin: assignment.origin,
      };
    }),
    uncovered: result.uncovered.map((slot) => {
      const requirement = requirements.find((r) => r.id === slot.positionId)!;
      return { shiftId: requirement.shiftId, role: requirement.roleId, reasons: slot.reasons };
    }),
  };
}

export function agendaStaffingReport(
  snapshot: Pick<AgendaSnapshot, "shifts" | "roleMembers" | "assignments" | "occurrences"> & {
    staffingRoles?: AgendaStaffingPositionPlan["roles"];
    staffingPosts?: AgendaStaffingPositionPlan["posts"];
    staffingRequirements?: AgendaStaffingPositionPlan["requirements"];
    staffingPositions?: AgendaStaffingPositionPlan["positions"];
    travelMinutes?: number;
  },
  unavailablePairs: ReadonlySet<string> = new Set(),
) {
  const requirements = snapshot.staffingRequirements ?? [],
    positions = snapshot.staffingPositions ?? [];
  const coverage = agendaStaffingPositionCoverage({
    roles: snapshot.staffingRoles ?? [],
    posts: snapshot.staffingPosts ?? [],
    requirements,
    positions,
    assignments: snapshot.assignments,
  });
  return {
    people: snapshot.roleMembers.map((person) => {
      const work = snapshot.assignments.filter((item) => item.userId === person.userId);
      return {
        userId: person.userId,
        displayName: person.displayName,
        minutes: work.reduce(
          (sum, item) => sum + agendaShiftMinutes(snapshot.shifts.find((b) => b.id === item.shiftId)),
          0,
        ),
        pinnedCount: work.filter((item) => item.pinned).length,
        manualCount: work.filter((item) => item.origin !== "generated").length,
        roles: person.roles.map((role) => ({
          role,
          minutes: work
            .filter((item) => item.role === role)
            .reduce((sum, item) => sum + agendaShiftMinutes(snapshot.shifts.find((b) => b.id === item.shiftId)), 0),
        })),
      };
    }),
    coverage,
    uncovered: requirements.length
      ? agendaStaffingPositionShortfalls({
          roles: snapshot.staffingRoles ?? [],
          posts: snapshot.staffingPosts ?? [],
          requirements,
          positions,
          assignments: snapshot.assignments,
          shifts: snapshot.shifts,
          members: snapshot.roleMembers,
          occurrences: snapshot.occurrences,
          travelMinutes: snapshot.travelMinutes,
          unavailablePairs,
        })
      : snapshot.shifts.flatMap((shift) =>
          shift.roles
            .filter((role) => !snapshot.assignments.some((item) => item.shiftId === shift.id && item.role === role))
            .map((role) => ({ shiftId: shift.id, role, reasons: [], eligiblePeople: 0 })),
        ),
    boundaryChanges: snapshot.shifts.flatMap((shift) =>
      (["start", "end"] as const).flatMap((boundary) => {
        const occurrenceId =
          boundary === "start" ? shift.boundaries?.startOccurrenceId : shift.boundaries?.endOccurrenceId;
        if (!occurrenceId) return [];
        const occurrence = snapshot.occurrences.find((item) => item.id === occurrenceId);
        const expected = boundary === "start" ? occurrence?.endAt : occurrence?.startAt;
        return expected !== (boundary === "start" ? shift.startAt : shift.endAt)
          ? [{ shiftId: shift.id, boundary, occurrenceId }]
          : [];
      }),
    ),
  };
}
