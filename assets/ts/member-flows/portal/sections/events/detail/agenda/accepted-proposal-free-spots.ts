import { agendaConflicts, agendaRoomIsAvailable } from "../../../../../../../shared/event-agenda-policy";
import { agendaPresenter } from "./presenter";
import type { AgendaSnapshot } from "../../../../../../../shared/schemas/event-agenda";

/** Candidate locations only: the ordinary placement preview remains authoritative for speaker and staffing conflicts. */
export function acceptedProposalFreeSpots(
  snapshot: AgendaSnapshot,
  day: string,
  durationMinutes: number,
  step: number,
) {
  if (!snapshot.eventStartsAt || !snapshot.eventEndsAt)
    throw new Error("Set the event start and end before adding proposals to the calendar.");
  if (!Number.isFinite(step) || step <= 0) throw new Error("Choose a valid calendar time step.");
  // Use the same daily hours and slot geometry as the actual planning canvas, including intermediate days.
  const visible = agendaPresenter(snapshot, step).find((value) => value.date === day);
  if (!visible?.slots.length) return [];
  const start = Math.max(Date.parse(visible.slots[0].startsAt), Date.parse(snapshot.eventStartsAt));
  const end = Math.min(Date.parse(visible.slots[visible.slots.length - 1].startsAt), Date.parse(snapshot.eventEndsAt));
  const spots: Array<{ startAt: string; endAt: string; roomId: string }> = [];
  for (const slot of visible.slots) {
    const instant = Date.parse(slot.startsAt);
    if (instant < start || instant + durationMinutes * 60000 > end) continue;
    const startAt = new Date(instant).toISOString();
    const endAt = new Date(instant + durationMinutes * 60000).toISOString();
    for (const room of snapshot.rooms) {
      if (!agendaRoomIsAvailable(room, startAt, endAt)) continue;
      const candidate = {
        id: "candidate",
        title: "Accepted proposal",
        description: "",
        startAt,
        endAt,
        roomId: room.id,
        admissionPolicy: "preference" as const,
        visibility: "public" as const,
        kind: "session" as const,
        capacity: null,
        remoteCapacity: null,
        speakers: [],
      };
      if (
        snapshot.occurrences.some(
          (other) => agendaConflicts([candidate, other], snapshot.travelMinutes, snapshot.rooms).length,
        )
      )
        continue;
      spots.push({ startAt, endAt, roomId: room.id });
    }
  }
  // Random sampling without replacement avoids favoring the earliest room or repeating refused candidates.
  for (let index = spots.length - 1; index > 0; index--) {
    const selected = Math.floor(Math.random() * (index + 1));
    [spots[index], spots[selected]] = [spots[selected], spots[index]];
  }
  return spots;
}
