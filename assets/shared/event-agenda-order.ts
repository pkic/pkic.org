import type { AgendaOccurrence } from "./schemas/event-agenda";
import { instantToDateTimeLocal } from "./timezone";
import { agendaOccurrenceRoomIds } from "./event-agenda-rooms";

/** Card arrows move between sessions; breaks are fixed barriers, never displaced neighbors. */
export function stepAgendaSession(
  occurrences: AgendaOccurrence[],
  session: AgendaOccurrence,
  timeZone: string,
  direction: -1 | 1,
  bounds?: { startAt: string; endAt: string },
) {
  if (!session.startAt || !session.endAt || session.kind === "break")
    throw new Error("Choose a scheduled session to move.");
  const date = instantToDateTimeLocal(session.startAt, timeZone).slice(0, 10);
  const rooms = agendaOccurrenceRoomIds(session);
  const relevant = canonicalAgendaOrder(occurrences).filter((item) => {
    const otherRooms = agendaOccurrenceRoomIds(item);
    return (
      instantToDateTimeLocal(item.startAt!, timeZone).startsWith(date) &&
      (item.id === session.id ||
        (item.kind === "break" && !otherRooms.length) ||
        (rooms.length ? otherRooms.some((room) => rooms.includes(room)) : !otherRooms.length))
    );
  });
  const neighbor = relevant[relevant.findIndex((item) => item.id === session.id) + direction];
  const duration = Date.parse(session.endAt) - Date.parse(session.startAt);
  const change = (item: AgendaOccurrence, start: number) => ({
    id: item.id,
    startAt: new Date(start).toISOString(),
    endAt: new Date(start + Date.parse(item.endAt!) - Date.parse(item.startAt!)).toISOString(),
    roomId: item.roomId,
    additionalRoomIds: item.additionalRoomIds ?? [],
  });
  let changes;
  if (neighbor && neighbor.kind !== "break") {
    const [first, last] = direction === 1 ? [session, neighbor] : [neighbor, session];
    const start = Date.parse(first.startAt!);
    const gap = Math.max(0, Date.parse(last.startAt!) - Date.parse(first.endAt!));
    changes = [change(last, start), change(first, start + Date.parse(last.endAt!) - Date.parse(last.startAt!) + gap)];
  } else {
    let start = direction === 1 ? Date.parse(session.endAt) : Date.parse(session.startAt) - duration;
    const breaks = relevant.filter((item) => item.kind === "break");
    for (const item of direction === 1 ? breaks : breaks.reverse()) {
      if (start < Date.parse(item.endAt!) && start + duration > Date.parse(item.startAt!))
        start = direction === 1 ? Date.parse(item.endAt!) : Date.parse(item.startAt!) - duration;
    }
    changes = [change(session, start)];
  }
  if (
    changes.some(
      (item) =>
        !instantToDateTimeLocal(item.startAt, timeZone).startsWith(date) ||
        !instantToDateTimeLocal(new Date(Date.parse(item.endAt) - 1).toISOString(), timeZone).startsWith(date) ||
        (bounds && (item.startAt < bounds.startAt || item.endAt > bounds.endAt)),
    )
  )
    throw new Error("This move would go outside the calendar day. Choose another time or day.");
  return changes;
}
/** Schedule order is independent of a table's search, filters, paging, and sorting. */
export function canonicalAgendaOrder(occurrences: AgendaOccurrence[]) {
  return occurrences
    .filter((item) => item.startAt && item.endAt)
    .sort(
      (a, b) =>
        a.startAt!.localeCompare(b.startAt!) ||
        (a.roomId ?? "").localeCompare(b.roomId ?? "") ||
        a.id.localeCompare(b.id),
    );
}
export function adjacentAgendaSession(
  occurrences: AgendaOccurrence[],
  session: AgendaOccurrence,
  timeZone: string,
  direction: -1 | 1,
) {
  if (!session.startAt) return null;
  const day = instantToDateTimeLocal(session.startAt, timeZone).slice(0, 10);
  const ordered = canonicalAgendaOrder(occurrences).filter(
    (item) => item.roomId === session.roomId && instantToDateTimeLocal(item.startAt!, timeZone).startsWith(day),
  );
  return ordered[ordered.findIndex((item) => item.id === session.id) + direction] ?? null;
}
/** Move every selected session one canonical slot, preserving relative order within each day/location. */
export function stepAgendaSessions(
  occurrences: AgendaOccurrence[],
  selected: ReadonlySet<string>,
  timeZone: string,
  direction: -1 | 1,
) {
  if (occurrences.some((item) => selected.has(item.id) && (!item.startAt || !item.endAt)))
    throw new Error("Schedule selected sessions before changing their order.");
  const groups = new Map<string, AgendaOccurrence[]>();
  for (const item of canonicalAgendaOrder(occurrences)) {
    const key = JSON.stringify([instantToDateTimeLocal(item.startAt!, timeZone).slice(0, 10), item.roomId]);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  const changes: Array<{
    id: string;
    startAt: string;
    endAt: string;
    roomId: string | null;
    additionalRoomIds: string[];
  }> = [];
  for (const slots of groups.values()) {
    const reordered = [...slots];
    const indices = direction === -1 ? slots.map((_, index) => index) : slots.map((_, index) => index).reverse();
    for (const index of indices) {
      const other = index + direction;
      if (
        selected.has(reordered[index]!.id) &&
        reordered[index]!.kind !== "break" &&
        reordered[other] &&
        reordered[other]!.kind !== "break" &&
        !selected.has(reordered[other]!.id)
      )
        [reordered[index], reordered[other]] = [reordered[other]!, reordered[index]!];
    }
    let index = 0;
    while (index < slots.length) {
      if (slots[index]!.id === reordered[index]!.id) {
        index++;
        continue;
      }
      const first = index;
      while (index + 1 < slots.length && slots[index + 1]!.id !== reordered[index + 1]!.id) index++;
      const last = index;
      let cursor = Date.parse(slots[first]!.startAt!);
      for (let position = first; position <= last; position++) {
        const item = reordered[position]!;
        const duration = Date.parse(item.endAt!) - Date.parse(item.startAt!);
        changes.push({
          id: item.id,
          startAt: new Date(cursor).toISOString(),
          endAt: new Date(cursor + duration).toISOString(),
          roomId: item.roomId,
          additionalRoomIds: item.additionalRoomIds ?? [],
        });
        cursor += duration;
        if (position < last)
          cursor += Math.max(0, Date.parse(slots[position + 1]!.startAt!) - Date.parse(slots[position]!.endAt!));
      }
      index++;
    }
  }
  if (!changes.length) throw new Error("Selected sessions are already at the edge of their day and location.");
  return changes;
}
