import type { AgendaAssignment, AgendaBlock, AgendaOccurrence, AgendaRoleMember } from "./schemas/event-agenda";

export function intervalsOverlap(start: string, end: string, otherStart: string, otherEnd: string) {
  return start < otherEnd && otherStart < end;
}
export function agendaConflicts(
  occurrences: AgendaOccurrence[],
  travelMinutes = 0,
  rooms: Array<{ id: string; setupMinutes: number }> = [],
) {
  const conflicts: string[] = [];
  for (let i = 0; i < occurrences.length; i++) {
    const a = occurrences[i];
    if (!a.startAt || !a.endAt) continue;
    if (a.endAt <= a.startAt) conflicts.push(`${a.title}: end must follow start`);
    for (const b of occurrences.slice(i + 1)) {
      if (!b.startAt || !b.endAt) continue;
      const gap =
        Math.max(Date.parse(a.startAt) - Date.parse(b.endAt), Date.parse(b.startAt) - Date.parse(a.endAt)) / 60000;
      const overlap = intervalsOverlap(a.startAt, a.endAt, b.startAt, b.endAt);
      const setup = rooms.find((room) => room.id === a.roomId)?.setupMinutes ?? 0;
      if (a.roomId === b.roomId && a.roomId && !overlap && gap < setup)
        conflicts.push(`${a.title} and ${b.title} need room setup time`);
      if (
        a.roomId !== b.roomId &&
        gap < travelMinutes &&
        a.speakers.some((speaker) => b.speakers.some((other) => other.userId === speaker.userId))
      )
        conflicts.push(`${a.title} and ${b.title} need speaker travel time`);
      if (!overlap) continue;
      if (a.roomId && a.roomId === b.roomId) conflicts.push(`${a.title} and ${b.title} overlap in the same room`);
      if (a.speakers.some((speaker) => b.speakers.some((other) => other.userId === speaker.userId)))
        conflicts.push(`${a.title} and ${b.title} share a speaker at the same time`);
    }
  }
  return conflicts;
}
/** Seeded tie breaking is reproducible, while duration balancing includes pinned work. */
export function allocateAgendaRoles(
  blocks: AgendaBlock[],
  members: AgendaRoleMember[],
  pinned: AgendaAssignment[],
  occurrences: AgendaOccurrence[],
  seed: string,
  strategy: "balanced" | "random",
) {
  let state = [...seed].reduce((value, char) => (value * 31 + char.charCodeAt(0)) >>> 0, 2166136261);
  const random = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
  const assignments = [...pinned];
  const minutes = new Map<string, number>();
  const duration = (block: AgendaBlock) => (Date.parse(block.endAt) - Date.parse(block.startAt)) / 60000;
  for (const assignment of pinned) {
    const block = blocks.find((item) => item.id === assignment.blockId);
    if (block) minutes.set(assignment.userId, (minutes.get(assignment.userId) ?? 0) + duration(block));
  }
  const uncovered: Array<{ blockId: string; role: string }> = [];
  for (const block of [...blocks].sort((a, b) => a.startAt.localeCompare(b.startAt) || a.id.localeCompare(b.id))) {
    for (const role of block.roles) {
      if (assignments.some((item) => item.blockId === block.id && item.role === role)) continue;
      const candidates = members
        .filter(
          (member) =>
            member.roles.includes(role) &&
            block.roleRequirements.every(
              (requirement) =>
                requirement.role !== role ||
                ((requirement.seniority !== "senior" || member.seniority === "senior") &&
                  (requirement.attendanceMode === "any" || requirement.attendanceMode === member.attendanceMode)),
            ) &&
            (!member.availableFrom || member.availableFrom <= block.startAt) &&
            (!member.availableUntil || member.availableUntil >= block.endAt) &&
            (!member.maxMinutes || (minutes.get(member.userId) ?? 0) + duration(block) <= member.maxMinutes) &&
            !assignments.some((assigned) => {
              const other = blocks.find((item) => item.id === assigned.blockId);
              return (
                assigned.userId === member.userId &&
                other &&
                intervalsOverlap(block.startAt, block.endAt, other.startAt, other.endAt)
              );
            }) &&
            !occurrences.some(
              (occurrence) =>
                occurrence.startAt &&
                occurrence.endAt &&
                occurrence.speakers.some((speaker) => speaker.userId === member.userId) &&
                intervalsOverlap(block.startAt, block.endAt, occurrence.startAt, occurrence.endAt),
            ),
        )
        .map((member) => ({ member, tie: random(), load: minutes.get(member.userId) ?? 0 }))
        .sort(
          (a, b) =>
            a.load - b.load || (strategy === "random" ? a.tie - b.tie : a.member.userId.localeCompare(b.member.userId)),
        );
      const chosen = candidates[0]?.member;
      if (!chosen) {
        uncovered.push({ blockId: block.id, role });
        continue;
      }
      assignments.push({ blockId: block.id, role, userId: chosen.userId, pinned: false });
      minutes.set(chosen.userId, (minutes.get(chosen.userId) ?? 0) + duration(block));
    }
  }
  return { assignments, uncovered };
}
