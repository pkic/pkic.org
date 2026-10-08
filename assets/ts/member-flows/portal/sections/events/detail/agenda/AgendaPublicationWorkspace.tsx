import { useState } from "preact/hooks";
import {
  agendaRevisionSchema,
  agendaSnapshotSchema,
  type AgendaSnapshot,
} from "../../../../../../../shared/schemas/event-agenda";
import { postJson } from "../../../../../../shared/api-client";
import { ErrorAlert } from "../../../../../../components/ErrorAlert";
import { AgendaPublicPreview } from "./AgendaPublicPreview";
import { AgendaPublicationReview } from "./AgendaPublicationReview";

/** Dedicated approval interaction owns its preview, request state and refusal. */
export function AgendaPublicationWorkspace({
  snapshot,
  canEdit,
  onSaved,
  onClose,
}: {
  snapshot: AgendaSnapshot;
  canEdit: boolean;
  onSaved: (snapshot: AgendaSnapshot) => void;
  onClose: () => void;
}) {
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function approve() {
    setBusy(true);
    setError("");
    try {
      onSaved(
        await postJson(
          `/api/v1/events/${encodeURIComponent(snapshot.eventSlug)}/agenda/publications`,
          agendaRevisionSchema.parse({ expectedRevision: snapshot.revision }),
          agendaSnapshotSchema,
        ),
      );
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Publication approval failed");
    } finally {
      setBusy(false);
    }
  }
  if (preview) return <AgendaPublicPreview slug={snapshot.eventSlug} onClose={() => setPreview(false)} />;
  return (
    <div class="pk-stack">
      {error && <ErrorAlert error={error} />}
      <AgendaPublicationReview
        snapshot={snapshot}
        canEdit={canEdit}
        busy={busy}
        onClose={onClose}
        onPreview={() => setPreview(true)}
        onApprove={() => void approve()}
      />
    </div>
  );
}
