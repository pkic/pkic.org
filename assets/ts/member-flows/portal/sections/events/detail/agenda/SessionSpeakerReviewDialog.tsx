import { useRef, useState } from "preact/hooks";
import { AppearanceFields } from "./SessionArchiveFields";
import type { AgendaOccurrence, AgendaSnapshot } from "../../../../../../../shared/schemas/event-agenda";
import { agendaSnapshotSchema } from "../../../../../../../shared/schemas/event-agenda";
import {
  sessionHistoryCorrectionSchema,
  sessionHistoryMetadataSchema,
} from "../../../../../../../shared/schemas/event-session-history";
import { useContractForm } from "../../../../../../hooks/useContractForm";
import { postJson } from "../../../../../../shared/api-client";
import { Dialog } from "../../../../../../ui/Dialog";
import { ErrorAlert } from "../../../../../../components/ErrorAlert";

/** Review one speaker's event appearance without changing their personal profile. */
export function SessionSpeakerReviewDialog({
  snapshot,
  occurrence,
  speaker,
  onSaved,
  onClose,
}: {
  snapshot: AgendaSnapshot;
  occurrence: AgendaOccurrence;
  speaker: AgendaOccurrence["speakers"][number];
  onSaved: (snapshot: AgendaSnapshot) => void;
  onClose: () => void;
}) {
  const formElement = useRef<HTMLFormElement>(null);
  const original = sessionHistoryMetadataSchema.parse(occurrence.history ?? {});
  const [appearances, setAppearances] = useState(original.appearances.filter((item) => item.userId === speaker.userId));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const form = useContractForm(sessionHistoryCorrectionSchema, {
    expectedRevision: snapshot.revision,
    history: {
      ...original,
      appearances: [...original.appearances.filter((item) => item.userId !== speaker.userId), ...appearances],
    },
  });
  async function save(event: Event) {
    event.preventDefault();
    event.stopPropagation();
    if (busy) return;
    const checked = form.submit();
    if (!checked.data) {
      setError(checked.message);
      return;
    }
    setBusy(true);
    setError("");
    try {
      onSaved(
        await postJson(
          `/api/v1/events/${encodeURIComponent(snapshot.eventSlug)}/agenda/occurrences/${encodeURIComponent(occurrence.id)}/history`,
          checked.data,
          agendaSnapshotSchema,
        ),
      );
      onClose();
    } catch (failure) {
      setError(form.refuse(failure));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      title={`Speaker details · ${speaker.displayName}`}
      confirmLabel={busy ? "Saving…" : "Save speaker details"}
      confirmDisabled={busy || !appearances.length}
      onConfirm={() => formElement.current?.requestSubmit()}
      onCancel={() => {
        if (!busy) onClose();
      }}
    >
      {error && <ErrorAlert error={error} />}
      <form ref={formElement} noValidate {...form.handlers} onSubmit={(event) => void save(event)}>
        <fieldset disabled={busy} class="pk-fieldset">
          <AppearanceFields
            slug={snapshot.eventSlug}
            occurrenceId={occurrence.id}
            speakers={[speaker]}
            sourceRepresentations={original.proposalRepresentations}
            appearances={appearances}
            onChange={setAppearances}
          />
        </fieldset>
      </form>
    </Dialog>
  );
}
