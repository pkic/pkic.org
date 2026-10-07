import type { AgendaSnapshot } from "./schemas/event-agenda";
import type { ContentAgendaStaffingShift } from "./site-agenda";
import { instantToDateTimeLocal } from "./timezone";
import { agendaStaffingShiftAppliesToOccurrence } from "./event-agenda-staffing-scope";

/** Public display carries approved names and duties, never allocation or permission data. */
export function agendaDisplayRoles(
  snapshot: AgendaSnapshot,
  date: string,
  publicOnly = false,
): ContentAgendaStaffingShift[] {
  if (snapshot.displayRoles)
    return snapshot.displayRoles.filter(
      (shift) => instantToDateTimeLocal(shift.startAt, snapshot.timeZone).slice(0, 10) === date,
    );
  const people = new Map(snapshot.roleMembers.map((person) => [person.userId, person.displayName]));
  const roles = new Map(snapshot.staffingRoles.map((role) => [role.id, role]));
  return snapshot.shifts
    .filter(
      (shift) =>
        instantToDateTimeLocal(shift.startAt, snapshot.timeZone).slice(0, 10) === date &&
        (!publicOnly ||
          snapshot.occurrences.some(
            (session) => session.visibility === "public" && agendaStaffingShiftAppliesToOccurrence(shift, session),
          )),
    )
    .map((shift) => ({
      id: shift.id,
      name: shift.name,
      startAt: shift.startAt,
      endAt: shift.endAt,
      locationId: shift.roomId,
      track: shift.track ?? undefined,
      duties: snapshot.assignments
        .filter(
          (assignment) =>
            assignment.shiftId === shift.id &&
            people.has(assignment.userId) &&
            (!publicOnly || roles.get(assignment.role)?.showOnAgenda === true),
        )
        .map((assignment) => ({
          role: roles.get(assignment.role)?.name ?? assignment.role,
          displayName: people.get(assignment.userId)!,
        })),
    }))
    .filter((shift) => !publicOnly || shift.duties.length > 0)
    .sort((a, b) => a.startAt.localeCompare(b.startAt) || a.name.localeCompare(b.name));
}
