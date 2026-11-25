/**
 * Writes the sponsor team's one shared note about a lead, from the scanner right after a capture or from the
 * lead's page. The note replaces the previous one; saving an empty note removes it.
 */
import { useState } from "preact/hooks";
import { putJson } from "../../../../../../shared/api-client";
import {
  SPONSOR_LEAD_NOTE_MAX_LENGTH,
  sponsorLeadNoteRequestSchema,
  sponsorLeadNoteResponseSchema,
} from "../../../../../../../shared/schemas/event-sponsor-lead-list";
import { formatNumber } from "../../../../../../../shared/format-number";
import { useContractForm } from "../../../../../../hooks/useContractForm";
import { Alert } from "../../../../../../ui/Alert";
import { Dialog } from "../../../../../../ui/Dialog";
import { Field } from "../../../../../../ui/Field";
import { Textarea } from "../../../../../../ui/TextControl";

export function SponsorLeadNoteDialog({
  slug,
  sponsorId,
  leadId,
  name,
  note: savedNote,
  onClose,
  onSaved,
}: {
  slug: string;
  sponsorId: string;
  leadId: string;
  /** The lead's name, when known, for the dialog title. */
  name: string | null;
  note: string | null;
  onClose: () => void;
  onSaved: (note: string | null) => void;
}) {
  const [note, setNote] = useState(savedNote ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const form = useContractForm(sponsorLeadNoteRequestSchema, { note });

  async function save() {
    if (saving) return;
    const checked = form.submit();
    if (!checked.data) return setError(checked.formMessage ?? "");
    setSaving(true);
    setError("");
    try {
      const saved = await putJson(
        `/api/v1/events/${encodeURIComponent(slug)}/sponsors/${encodeURIComponent(sponsorId)}/leads/${encodeURIComponent(leadId)}/note`,
        checked.data,
        sponsorLeadNoteResponseSchema,
      );
      onSaved(saved.note);
    } catch (cause) {
      setError(form.refuse(cause));
      setSaving(false);
    }
  }

  return (
    <Dialog
      open
      title={name ? `Note about ${name}` : "Lead note"}
      closeLabel="Close note"
      description="Everyone on your team who can see this lead can see this note."
      confirmLabel="Save note"
      confirmDisabled={saving}
      onConfirm={() => void save()}
      onCancel={() => {
        // A pending save finishes in this dialog, so its result never lands in a dialog opened after it.
        if (!saving) onClose();
      }}
    >
      <form
        noValidate
        class="pk-stack"
        {...form.handlers}
        onSubmit={(submitEvent) => {
          submitEvent.preventDefault();
          void save();
        }}
      >
        <Field
          {...form.of("note")}
          label="Note"
          help={`Up to ${formatNumber(SPONSOR_LEAD_NOTE_MAX_LENGTH)} characters.`}
        >
          {(control) => (
            <Textarea
              {...control}
              name="note"
              rows={5}
              // The note is the dialog's only task, so typing starts at once.
              autoFocus
              value={note}
              disabled={saving}
              onInput={(event) => setNote(event.currentTarget.value)}
            />
          )}
        </Field>
        {error && <Alert tone="danger">{error}</Alert>}
      </form>
    </Dialog>
  );
}
