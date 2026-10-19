import { agendaStaffingTrackLocationConflict } from "./event-agenda-staffing-scope";
import { agendaSpeakerPhysicalRoom } from "./event-agenda-rooms";
import type { AgendaAssignment, AgendaShift, AgendaRoleMember, AgendaOccurrence } from "./schemas/event-agenda";
import { agendaDutyIntervalsConflict } from "./event-agenda-intervals";
export const agendaStaffingReasonLabels = {
  role: "Role is outside this person's eligible roles",
  experience: "Senior experience is required",
  attendance: "Attendance mode does not match",
  availability: "Person is unavailable for the complete shift",
  workload: "Maximum duty minutes would be exceeded",
  conflict: "Another duty or talk conflicts, including travel",
  external_conflict: "A duty or talk in another event conflicts",
} as const;
export function agendaDutiesCompatible(shift: AgendaShift, firstRole: string, other: AgendaShift, secondRole: string) {
  return (
    shift.id === other.id &&
    firstRole !== secondRole &&
    Boolean(
      shift.compatibleRolePairs?.some(
        ([a, b]) => (a === firstRole && b === secondRole) || (b === firstRole && a === secondRole),
      ),
    )
  );
}
export function agendaStaffingEligibility(
  member: AgendaRoleMember,
  shift: AgendaShift,
  role: string,
  shifts: AgendaShift[],
  assignments: Omit<AgendaAssignment, "positionId" | "postId">[],
  occurrences: AgendaOccurrence[],
  travelMinutes = 0,
  unavailablePairs: ReadonlySet<string> = new Set(),
  compatible: typeof agendaDutiesCompatible = agendaDutiesCompatible,
  authoredScope: AgendaShift = shift,
) {
  const reasons: Array<keyof typeof agendaStaffingReasonLabels> = [];
  if (!member.roles.includes(role)) reasons.push("role");
  const requirement = shift.roleRequirements.find((item) => item.role === role);
  if (requirement?.seniority === "senior" && member.seniority !== "senior") reasons.push("experience");
  if (requirement && requirement.attendanceMode !== "any" && requirement.attendanceMode !== member.attendanceMode)
    reasons.push("attendance");
  if (
    (member.availableFrom && member.availableFrom > shift.startAt) ||
    (member.availableUntil && member.availableUntil < shift.endAt)
  )
    reasons.push("availability");
  const assigned = assignments.filter((item) => item.userId === member.userId);
  const minutes = assigned.reduce(
    (total, item) => total + agendaShiftMinutes(shifts.find((b) => b.id === item.shiftId)),
    0,
  );
  if (member.maxMinutes !== null && minutes + agendaShiftMinutes(shift) > member.maxMinutes) reasons.push("workload");
  if (unavailablePairs.has(JSON.stringify([shift.id, member.userId]))) reasons.push("external_conflict");
  if (
    (member.attendanceMode === "physical" &&
      agendaStaffingTrackLocationConflict(shift, occurrences, travelMinutes, authoredScope)) ||
    assigned.some((item) => {
      const other = shifts.find((b) => b.id === item.shiftId);
      return (
        other &&
        !compatible(shift, role, other, item.role) &&
        agendaDutyIntervalsConflict(shift, other, member.attendanceMode === "remote" ? 0 : travelMinutes)
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
              shift,
              { startAt: item.startAt!, endAt: item.endAt!, roomId: agendaSpeakerPhysicalRoom(item, speaker) },
              speaker.attendanceMode === "remote" || member.attendanceMode === "remote" ? 0 : travelMinutes,
            ),
        ),
    )
  )
    reasons.push("conflict");
  return reasons;
}
export function agendaShiftMinutes(shift?: AgendaShift) {
  return shift ? (Date.parse(shift.endAt) - Date.parse(shift.startAt)) / 60000 : 0;
}
