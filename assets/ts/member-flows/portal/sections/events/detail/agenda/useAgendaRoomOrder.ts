import { useRef, useState } from "preact/hooks";
import { agendaRoomOrderSchema } from "../../../../../../../shared/schemas/event-agenda-room-order";
import { agendaSnapshotSchema, type AgendaSnapshot } from "../../../../../../../shared/schemas/event-agenda";
import { postJson } from "../../../../../../shared/api-client";

/** Reorder location columns without changing the sessions assigned to them. */
export function useAgendaRoomOrder(snapshot: AgendaSnapshot, onSaved: (snapshot: AgendaSnapshot) => void) {
  const posting = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  function canMove(roomId: string, direction: -1 | 1) {
    const index = snapshot.rooms.findIndex((room) => room.id === roomId);
    return index >= 0 && index + direction >= 0 && index + direction < snapshot.rooms.length;
  }
  async function move(roomId: string, direction: -1 | 1) {
    if (posting.current || !canMove(roomId, direction)) return;
    const roomIds = snapshot.rooms.map((room) => room.id);
    const index = roomIds.indexOf(roomId);
    [roomIds[index], roomIds[index + direction]] = [roomIds[index + direction], roomIds[index]];
    posting.current = true;
    setBusy(true);
    setError("");
    try {
      onSaved(
        await postJson(
          `/api/v1/events/${encodeURIComponent(snapshot.eventSlug)}/agenda/rooms/order`,
          agendaRoomOrderSchema.parse({ expectedRevision: snapshot.revision, roomIds }),
          agendaSnapshotSchema,
        ),
      );
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not change the location order.");
    } finally {
      posting.current = false;
      setBusy(false);
    }
  }
  return { busy, error, canMove, move };
}
