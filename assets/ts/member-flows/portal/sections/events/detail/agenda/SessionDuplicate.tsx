import { useState } from "preact/hooks";
import type { AgendaOccurrence, AgendaSnapshot } from "../../../../../../../shared/schemas/event-agenda";
import {
  agendaContentPlacementSchema,
  agendaContentPlacementResponseSchema,
} from "../../../../../../../shared/schemas/event-agenda-content";
import { postJson } from "../../../../../../shared/api-client";
import { Dialog } from "../../../../../../ui/Dialog";
import { ErrorAlert } from "../../../../../../components/ErrorAlert";

export function SessionDuplicate({
  snapshot,
  session,
  onSaved,
  onClose,
}: {
  snapshot: AgendaSnapshot;
  session: AgendaOccurrence;
  onSaved: (next: AgendaSnapshot) => void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function duplicate() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await postJson(
        `/api/v1/events/${encodeURIComponent(snapshot.eventSlug)}/agenda/occurrences/${encodeURIComponent(session.id)}/placements`,
        agendaContentPlacementSchema.parse({ expectedRevision: snapshot.revision, copyAsNew: false }),
        agendaContentPlacementResponseSchema,
      );
      onSaved(result.agenda);
      onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The session could not be duplicated.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      title={`Duplicate ${session.title}`}
      description="Create another unscheduled, private occurrence with the same session content and credited people. Choose its time, locations and registration policy separately."
      confirmLabel={busy ? "Duplicating…" : "Duplicate session"}
      confirmDisabled={busy}
      onConfirm={() => void duplicate()}
      onCancel={() => {
        if (!busy) onClose();
      }}
    >
      <p>Reservations, attendance, archive materials and publication approvals are not copied.</p>
      {error && <ErrorAlert error={error} />}
    </Dialog>
  );
}
