import type { AgendaBlock, AgendaRoleMember, AgendaOccurrence } from "./schemas/event-agenda";
import {
  agendaStaffingPositionPlanSchema,
  type AgendaStaffingPositionPlan,
} from "./schemas/event-agenda-staffing-positions";
import {
  agendaBlockMinutes,
  agendaDutiesCompatible,
  agendaStaffingEligibility,
  agendaStaffingReasonLabels,
} from "./event-agenda-staffing-eligibility";
export type AgendaStaffingPositionContext = AgendaStaffingPositionPlan & {
  blocks: AgendaBlock[];
  members: AgendaRoleMember[];
  occurrences: AgendaOccurrence[];
  travelMinutes?: number;
  unavailablePairs?: ReadonlySet<string>;
};
type PositionAssignment = AgendaStaffingPositionPlan["assignments"][number];
function positionContext(input: AgendaStaffingPositionContext) {
  const plan = agendaStaffingPositionPlanSchema.parse(input);
  const duties = plan.positions.map((position) => {
    const requirement = plan.requirements.find((row) => row.id === position.requirementId)!;
    const source = input.blocks.find((block) => block.id === requirement.blockId);
    if (!source) throw new Error("Staffing position refers to a block outside this event");
    const post = plan.posts.find((row) => row.id === requirement.postId);
    return {
      position,
      requirement,
      source,
      block: {
        ...source,
        id: position.id,
        roomId: post ? post.roomId : source.roomId,
        roleRequirements: [
          { role: requirement.roleId, seniority: requirement.seniority, attendanceMode: requirement.attendanceMode },
        ],
      },
    };
  });
  const compatible: typeof agendaDutiesCompatible = (first, firstRole, other, secondRole) => {
    const a = duties.find((duty) => duty.position.id === first.id)!,
      b = duties.find((duty) => duty.position.id === other.id)!;
    return (
      a.requirement.postId === b.requirement.postId && agendaDutiesCompatible(a.source, firstRole, b.source, secondRole)
    );
  };
  const eligibility = (positionId: string, userId: string, assignments: PositionAssignment[]) => {
    const duty = duties.find((row) => row.position.id === positionId),
      member = input.members.find((row) => row.userId === userId);
    if (!duty || !member) throw new Error("Staffing assignment refers to an unknown position or person");
    const work = assignments
      .filter((row) => row.positionId !== positionId)
      .map((row) => ({
        ...row,
        blockId: row.positionId,
      }));
    return agendaStaffingEligibility(
      member,
      duty.block,
      duty.requirement.roleId,
      duties.map((row) => row.block),
      work,
      input.occurrences,
      input.travelMinutes ?? 0,
      input.unavailablePairs ?? new Set(),
      compatible,
      duty.source,
    );
  };
  return { plan, duties, eligibility };
}
/** Uses the actual role and physical post; positions identify independent people needed for that role. */
export function agendaStaffingPositionEligibility(
  input: AgendaStaffingPositionContext,
  positionId: string,
  userId: string,
) {
  return positionContext(input).eligibility(positionId, userId, input.assignments);
}
export function validateAgendaStaffingPositionAssignments(input: AgendaStaffingPositionContext) {
  const context = positionContext(input);
  return context.plan.assignments.flatMap((assignment) => {
    const reasons = context.eligibility(assignment.positionId, assignment.userId, context.plan.assignments);
    return reasons.length ? [{ positionId: assignment.positionId, userId: assignment.userId, reasons }] : [];
  });
}
/** Explain current unfilled duties through the same eligibility policy used by allocation. */
export function agendaStaffingPositionShortfalls(input: AgendaStaffingPositionContext) {
  const { duties, eligibility } = positionContext(input);
  return duties
    .filter((duty) => !input.assignments.some((row) => row.positionId === duty.position.id))
    .map((duty) => {
      const evaluated = input.members.map((member) => eligibility(duty.position.id, member.userId, input.assignments));
      return {
        positionId: duty.position.id,
        blockId: duty.source.id,
        role: duty.requirement.roleId,
        postId: duty.requirement.postId,
        eligiblePeople: evaluated.filter((reasons) => reasons.length === 0).length,
        reasons: (Object.keys(agendaStaffingReasonLabels) as Array<keyof typeof agendaStaffingReasonLabels>)
          .map((reason) => ({ reason, people: evaluated.filter((reasons) => reasons.includes(reason)).length }))
          .filter((item) => item.people > 0),
      };
    });
}
/** One allocation engine serves legacy single-person roles and normalized multi-person posts. */
export function allocateAgendaStaffingPositions(
  input: AgendaStaffingPositionContext & {
    seed: string;
    strategy: "balanced" | "random";
    selectedBlockIds?: ReadonlySet<string>;
  },
) {
  const { plan, duties, eligibility } = positionContext(input);
  let state = [...input.seed].reduce((value, char) => (value * 31 + char.charCodeAt(0)) >>> 0, 2166136261);
  const random = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
  const assignments = [...plan.assignments];
  const ordered = [...duties].sort(
    (a, b) =>
      a.source.startAt.localeCompare(b.source.startAt) ||
      a.source.id.localeCompare(b.source.id) ||
      plan.requirements.indexOf(a.requirement) - plan.requirements.indexOf(b.requirement) ||
      a.position.index - b.position.index,
  );
  const uncovered: Array<{
    positionId: string;
    blockId: string;
    role: string;
    postId: string | null;
    reasons: Array<{ reason: keyof typeof agendaStaffingReasonLabels; people: number }>;
  }> = [];
  const minutes = (assignment: PositionAssignment) =>
    agendaBlockMinutes(duties.find((duty) => duty.position.id === assignment.positionId)?.block);
  for (const duty of ordered) {
    if (input.selectedBlockIds && !input.selectedBlockIds.has(duty.source.id)) continue;
    if (assignments.some((assignment) => assignment.positionId === duty.position.id)) continue;
    const evaluated = input.members.map((member) => ({
      member,
      reasons: eligibility(duty.position.id, member.userId, assignments),
    }));
    const previous = ordered
      .filter((other) => other.source.endAt <= duty.source.startAt && other.block.roomId === duty.block.roomId)
      .at(-1);
    const candidates = evaluated
      .filter((item) => !item.reasons.length)
      .map(({ member }) => {
        const work = assignments.filter((assignment) => assignment.userId === member.userId);
        return {
          member,
          tie: random(),
          load: work.reduce((total, assignment) => total + minutes(assignment), 0),
          roleLoad: work
            .filter((assignment) => assignment.role === duty.requirement.roleId)
            .reduce((total, assignment) => total + minutes(assignment), 0),
          consecutive: Number(
            Boolean(
              previous &&
              work.some(
                (assignment) =>
                  duties.find((other) => other.position.id === assignment.positionId)?.source.id === previous.source.id,
              ),
            ),
          ),
        };
      })
      .sort(
        (a, b) =>
          a.load - b.load ||
          a.roleLoad - b.roleLoad ||
          a.consecutive - b.consecutive ||
          (input.strategy === "random" ? a.tie - b.tie : a.member.userId.localeCompare(b.member.userId)),
      );
    if (!candidates.length) {
      uncovered.push({
        positionId: duty.position.id,
        blockId: duty.source.id,
        role: duty.requirement.roleId,
        postId: duty.requirement.postId,
        reasons: (Object.keys(agendaStaffingReasonLabels) as Array<keyof typeof agendaStaffingReasonLabels>)
          .map((reason) => ({ reason, people: evaluated.filter((item) => item.reasons.includes(reason)).length }))
          .filter((item) => item.people > 0),
      });
      continue;
    }
    assignments.push({
      positionId: duty.position.id,
      blockId: duty.source.id,
      role: duty.requirement.roleId,
      postId: duty.requirement.postId,
      userId: candidates[0].member.userId,
      pinned: false,
      origin: "generated",
    });
  }
  return { assignments, uncovered };
}
export function agendaStaffingPositionCoverage(plan: AgendaStaffingPositionPlan) {
  return plan.requirements.map((requirement) => {
    const positions = plan.positions.filter((position) => position.requirementId === requirement.id);
    const assigned = positions.filter((position) =>
      plan.assignments.some((assignment) => assignment.positionId === position.id),
    ).length;
    return {
      requirementId: requirement.id,
      blockId: requirement.blockId,
      role: requirement.roleId,
      postId: requirement.postId,
      idealCount: requirement.idealCount,
      assignedCount: assigned,
      missingCount: requirement.idealCount - assigned,
    };
  });
}
