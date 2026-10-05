import type {
  AgendaAssignment,
  AgendaBlock,
  AgendaRoleMember,
  AgendaOccurrence,
  AgendaSnapshot,
} from "./schemas/event-agenda";
export {
  agendaStaffingReasonLabels,
  agendaDutiesCompatible,
  agendaStaffingEligibility,
  agendaBlockMinutes,
} from "./event-agenda-staffing-eligibility";
import { agendaBlockMinutes } from "./event-agenda-staffing-eligibility";
import {
  allocateAgendaStaffingPositions,
  agendaStaffingPositionCoverage,
  agendaStaffingPositionShortfalls,
} from "./event-agenda-staffing-positions";
import type { AgendaStaffingPositionPlan } from "./schemas/event-agenda-staffing-positions";
/** Duration and role balance stay inside eligible pools. Consecutive duty is a soft preference. */
export function allocateAgendaRoles(
  blocks: AgendaBlock[],
  members: AgendaRoleMember[],
  pinned: Omit<AgendaAssignment, "positionId" | "postId">[],
  occurrences: AgendaOccurrence[],
  seed: string,
  strategy: "balanced" | "random",
  selectedBlockIds?: ReadonlySet<string>,
  travelMinutes = 0,
  unavailablePairs: ReadonlySet<string> = new Set(),
) {
  const requirements = blocks.flatMap((block, blockIndex) =>
    block.roles.map((role, roleIndex) => ({
      id: `legacy-${blockIndex}-${roleIndex}`,
      blockId: block.id,
      roleId: role,
      postId: null,
      idealCount: 1,
      seniority: block.roleRequirements.find((r) => r.role === role)?.seniority ?? "any",
      attendanceMode: block.roleRequirements.find((r) => r.role === role)?.attendanceMode ?? "any",
    })),
  );
  const positions = requirements.map((requirement) => ({
    id: requirement.id,
    requirementId: requirement.id,
    index: 1,
  }));
  const result = allocateAgendaStaffingPositions({
    blocks,
    members,
    requirements,
    positions,
    posts: [],
    occurrences,
    seed,
    strategy,
    selectedBlockIds,
    travelMinutes,
    roles: [...new Set(blocks.flatMap((block) => block.roles))].map((role) => ({
      id: role,
      name: role,
      showOnAgenda: false,
    })),
    assignments: pinned.map((assignment) => ({
      ...assignment,
      postId: null,
      positionId: requirements.find((r) => r.blockId === assignment.blockId && r.roleId === assignment.role)!.id,
    })),
    unavailablePairs: new Set(
      requirements.flatMap((r) =>
        members
          .filter((m) => unavailablePairs.has(JSON.stringify([r.blockId, m.userId])))
          .map((m) => JSON.stringify([r.id, m.userId])),
      ),
    ),
  });
  return {
    assignments: result.assignments.map((assignment) => {
      const requirement = requirements.find((r) => r.id === assignment.positionId)!;
      return {
        blockId: requirement.blockId,
        role: requirement.roleId,
        userId: assignment.userId,
        pinned: assignment.pinned,
        origin: assignment.origin,
      };
    }),
    uncovered: result.uncovered.map((slot) => {
      const requirement = requirements.find((r) => r.id === slot.positionId)!;
      return { blockId: requirement.blockId, role: requirement.roleId, reasons: slot.reasons };
    }),
  };
}

export function agendaStaffingReport(
  snapshot: Pick<AgendaSnapshot, "blocks" | "roleMembers" | "assignments" | "occurrences"> & {
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
          (sum, item) => sum + agendaBlockMinutes(snapshot.blocks.find((b) => b.id === item.blockId)),
          0,
        ),
        pinnedCount: work.filter((item) => item.pinned).length,
        manualCount: work.filter((item) => item.origin !== "generated").length,
        roles: person.roles.map((role) => ({
          role,
          minutes: work
            .filter((item) => item.role === role)
            .reduce((sum, item) => sum + agendaBlockMinutes(snapshot.blocks.find((b) => b.id === item.blockId)), 0),
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
          blocks: snapshot.blocks,
          members: snapshot.roleMembers,
          occurrences: snapshot.occurrences,
          travelMinutes: snapshot.travelMinutes,
          unavailablePairs,
        })
      : snapshot.blocks.flatMap((block) =>
          block.roles
            .filter((role) => !snapshot.assignments.some((item) => item.blockId === block.id && item.role === role))
            .map((role) => ({ blockId: block.id, role, reasons: [], eligiblePeople: 0 })),
        ),
    boundaryChanges: snapshot.blocks.flatMap((block) =>
      (["start", "end"] as const).flatMap((boundary) => {
        const occurrenceId =
          boundary === "start" ? block.boundaries?.startOccurrenceId : block.boundaries?.endOccurrenceId;
        if (!occurrenceId) return [];
        const occurrence = snapshot.occurrences.find((item) => item.id === occurrenceId);
        const expected = boundary === "start" ? occurrence?.endAt : occurrence?.startAt;
        return expected !== (boundary === "start" ? block.startAt : block.endAt)
          ? [{ blockId: block.id, boundary, occurrenceId }]
          : [];
      }),
    ),
  };
}
