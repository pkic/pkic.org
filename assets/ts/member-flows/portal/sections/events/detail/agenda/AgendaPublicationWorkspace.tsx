import { useContractForm } from "../../../../../../hooks/useContractForm";
import { useState } from "preact/hooks";
import {
  agendaPublicationSchema,
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
  const [acknowledgedSnapshot, setAcknowledgedSnapshot] = useState<AgendaSnapshot | null>(null);
  const acknowledgeArchiveRepresentation = acknowledgedSnapshot === snapshot;
  const form = useContractForm(agendaPublicationSchema, {
    expectedRevision: snapshot.revision,
    acknowledgeArchiveRepresentation,
  });
  async function approve(body: ReturnType<typeof agendaPublicationSchema.parse>) {
    setBusy(true);
    setError("");
    try {
      onSaved(
        await postJson(
          `/api/v1/events/${encodeURIComponent(snapshot.eventSlug)}/agenda/publications`,
          body,
          agendaSnapshotSchema,
        ),
      );
    } catch (failure) {
      setError(form.refuse(failure));
    } finally {
      setBusy(false);
    }
  }
  if (preview) return <AgendaPublicPreview slug={snapshot.eventSlug} onClose={() => setPreview(false)} />;
  return (
    <div class="pk-stack">
      {error && <ErrorAlert error={error} />}
      <form
        noValidate
        {...form.handlers}
        onSubmit={(event) => {
          event.preventDefault();
          const checked = form.submit();
          if (!checked.data) {
            setError(checked.message);
            return;
          }
          void approve(checked.data);
        }}
      >
        <AgendaPublicationReview
          snapshot={snapshot}
          canEdit={canEdit}
          busy={busy}
          acknowledgeArchiveRepresentation={acknowledgeArchiveRepresentation}
          onArchiveAcknowledgment={(value) => setAcknowledgedSnapshot(value ? snapshot : null)}
          acknowledgmentField={form.of("acknowledgeArchiveRepresentation")}
          onClose={onClose}
          onPreview={() => setPreview(true)}
        />
      </form>
    </div>
  );
}
