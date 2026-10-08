import { useState } from "preact/hooks";
import { agendaOccurrenceRoomIds } from "../../../../../../../shared/event-agenda-rooms";
import type { AgendaSnapshot, AgendaOccurrence } from "../../../../../../../shared/schemas/event-agenda";
import { Dialog } from "../../../../../../ui/Dialog";
import { AgendaLocationSelect } from "./AgendaLocationSelect";
import { ErrorAlert } from "../../../../../../components/ErrorAlert";
import type { useAgendaScheduling } from "./useAgendaScheduling";

/** A session reserves its chosen rooms in one guarded scheduling change. */
export function useAgendaSessionLocations(
  snapshot: AgendaSnapshot | null | undefined,
  scheduling: ReturnType<typeof useAgendaScheduling>,
) {
  const [session, setSession] = useState<AgendaOccurrence | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState("");
  function open(occurrence: AgendaOccurrence) {
    setSession(occurrence);
    setSelected(agendaOccurrenceRoomIds(occurrence));
    setError("");
  }
  async function save() {
    if (!session) return;
    const result = await scheduling.setRooms(session.id, selected);
    if (result.saved) setSession(null);
    else setError(result.message);
  }
  return {
    open,
    dialog: snapshot && session && (
      <Dialog
        open
        title={`Locations for ${session.title}`}
        confirmLabel="Save locations"
        confirmDisabled={scheduling.applying}
        onConfirm={() => void save()}
        onCancel={() => setSession(null)}
      >
        {error && <ErrorAlert error={error} />}
        <AgendaLocationSelect
          rooms={snapshot.rooms}
          globalAll={session.kind === "break"}
          value={session.kind === "break" && !selected.length ? null : selected}
          onChange={(ids) => setSelected(ids ?? [])}
          help="Choose one or more locations. Use Ctrl or Command to select several."
        />
      </Dialog>
    ),
  };
}
