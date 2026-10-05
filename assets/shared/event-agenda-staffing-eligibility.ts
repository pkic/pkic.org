import { agendaStaffingTrackLocationConflict } from "./event-agenda-staffing-scope";
import { agendaSpeakerPhysicalRoom } from "./event-agenda-rooms";
import type { AgendaAssignment, AgendaBlock, AgendaRoleMember, AgendaOccurrence } from "./schemas/event-agenda";
import { agendaDutyIntervalsConflict } from "./event-agenda-intervals";
export const agendaStaffingReasonLabels = {
  role: "Role is outside this person's eligible roles",
  experience: "Senior experience is required",
  attendance: "Attendance mode does not match",
  availability: "Person is unavailable for the complete block",
  workload: "Maximum duty minutes would be exceeded",
  conflict: "Another duty or talk conflicts, including travel",
  external_conflict: "A duty or talk in another event conflicts",
} as const;
export function agendaDutiesCompatible(block: AgendaBlock, firstRole: string, other: AgendaBlock, secondRole: string) {
  return (
    block.id === other.id &&
    firstRole !== secondRole &&
    Boolean(
      block.compatibleRolePairs?.some(
        ([a, b]) => (a === firstRole && b === secondRole) || (b === firstRole && a === secondRole),
      ),
    )
  );
}
export function agendaStaffingEligibility(
  member: AgendaRoleMember,
  block: AgendaBlock,
  role: string,
  blocks: AgendaBlock[],
  assignments: Omit<AgendaAssignment, "positionId" | "postId">[],
  occurrences: AgendaOccurrence[],
  travelMinutes = 0,
  unavailablePairs: ReadonlySet<string> = new Set(),
  compatible: typeof agendaDutiesCompatible = agendaDutiesCompatible,
  authoredScope: AgendaBlock = block,
) {
  const reasons: Array<keyof typeof agendaStaffingReasonLabels> = [];
  if (!member.roles.includes(role)) reasons.push("role");
  const requirement = block.roleRequirements.find((item) => item.role === role);
  if (requirement?.seniority === "senior" && member.seniority !== "senior") reasons.push("experience");
  if (requirement && requirement.attendanceMode !== "any" && requirement.attendanceMode !== member.attendanceMode)
    reasons.push("attendance");
  if (
    (member.availableFrom && member.availableFrom > block.startAt) ||
    (member.availableUntil && member.availableUntil < block.endAt)
  )
    reasons.push("availability");
  const assigned = assignments.filter((item) => item.userId === member.userId);
  const minutes = assigned.reduce(
    (total, item) => total + agendaBlockMinutes(blocks.find((b) => b.id === item.blockId)),
    0,
  );
  if (member.maxMinutes !== null && minutes + agendaBlockMinutes(block) > member.maxMinutes) reasons.push("workload");
  if (unavailablePairs.has(JSON.stringify([block.id, member.userId]))) reasons.push("external_conflict");
  if (
    (member.attendanceMode === "physical" &&
      agendaStaffingTrackLocationConflict(block, occurrences, travelMinutes, authoredScope)) ||
    assigned.some((item) => {
      const other = blocks.find((b) => b.id === item.blockId);
      return (
        other &&
        !compatible(block, role, other, item.role) &&
        agendaDutyIntervalsConflict(block, other, member.attendanceMode === "remote" ? 0 : travelMinutes)
      );
    }) ||
    occurrences.some(
      (item) =>
        item.startAt &&
        item.endAt &&
        item.speakers.some(
          (speaker) =>
            speaker.userId === member.userId &&
            agendaDutyIntervalsConflict(
              block,
              { startAt: item.startAt!, endAt: item.endAt!, roomId: agendaSpeakerPhysicalRoom(item, speaker) },
              speaker.attendanceMode === "remote" || member.attendanceMode === "remote" ? 0 : travelMinutes,
            ),
        ),
    )
  )
    reasons.push("conflict");
  return reasons;
}
export function agendaBlockMinutes(block?: AgendaBlock) {
  return block ? (Date.parse(block.endAt) - Date.parse(block.startAt)) / 60000 : 0;
}
