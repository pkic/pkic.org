import type { AgendaSnapshot } from "./schemas/event-agenda";
import type { ContentAgendaStaffingBlock } from "./site-agenda";
import { instantToDateTimeLocal } from "./timezone";
import { agendaStaffingBlockAppliesToOccurrence } from "./event-agenda-staffing-scope";

/** Public display carries approved names and duties, never allocation or permission data. */
export function agendaDisplayRoles(
  snapshot: AgendaSnapshot,
  date: string,
  publicOnly = false,
): ContentAgendaStaffingBlock[] {
  if (snapshot.displayRoles)
    return snapshot.displayRoles.filter(
      (block) => instantToDateTimeLocal(block.startAt, snapshot.timeZone).slice(0, 10) === date,
    );
  const people = new Map(snapshot.roleMembers.map((person) => [person.userId, person.displayName]));
  const roles = new Map(snapshot.staffingRoles.map((role) => [role.id, role]));
  return snapshot.blocks
    .filter(
      (block) =>
        instantToDateTimeLocal(block.startAt, snapshot.timeZone).slice(0, 10) === date &&
        (!publicOnly ||
          snapshot.occurrences.some(
            (session) => session.visibility === "public" && agendaStaffingBlockAppliesToOccurrence(block, session),
          )),
    )
    .map((block) => ({
      id: block.id,
      name: block.name,
      startAt: block.startAt,
      endAt: block.endAt,
      locationId: block.roomId,
      track: block.track ?? undefined,
      duties: snapshot.assignments
        .filter(
          (assignment) =>
            assignment.blockId === block.id &&
            people.has(assignment.userId) &&
            (!publicOnly || roles.get(assignment.role)?.showOnAgenda === true),
        )
        .map((assignment) => ({
          role: roles.get(assignment.role)?.name ?? assignment.role,
          displayName: people.get(assignment.userId)!,
        })),
    }))
    .filter((block) => !publicOnly || block.duties.length > 0)
    .sort((a, b) => a.startAt.localeCompare(b.startAt) || a.name.localeCompare(b.name));
}
