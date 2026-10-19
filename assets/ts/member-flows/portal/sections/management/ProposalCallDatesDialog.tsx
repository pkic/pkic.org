import { Alert } from "../../../../ui/Alert";
import { Dialog } from "../../../../ui/Dialog";
import {
  EventSubmissionWindowFields,
  useEventSubmissionWindow,
  type PlacementResponse,
  type SubmissionPlacement,
} from "./EventSubmissionWindow";

/**
 * The call for proposals' Opens and Closes, edited from the Proposals tab.
 *
 * It is the Settings panel's own window editor (`useEventSubmissionWindow` and
 * its fields), set in the event's zone, in a dialog: the same contract, the
 * same PATCH, a different place to reach it.
 */
export function ProposalCallDatesDialog({
  base,
  placement,
  expectedUpdatedAt,
  timeZone,
  onSaved,
  onClose,
}: {
  base: string;
  placement: SubmissionPlacement;
  expectedUpdatedAt: string;
  timeZone: string;
  onSaved: (response: PlacementResponse) => void;
  onClose: () => void;
}) {
  const editor = useEventSubmissionWindow({ base, placement, expectedUpdatedAt, timeZone, onSaved });
  async function save() {
    if (await editor.save()) onClose();
  }
  return (
    <Dialog
      open
      title="Change call for proposals dates"
      description="Speakers can submit proposals between these two times."
      confirmLabel={editor.saving ? "Saving…" : "Save dates"}
      confirmDisabled={editor.saving}
      onConfirm={() => void save()}
      onCancel={onClose}
    >
      <form
        noValidate
        class="pk-stack"
        {...editor.form.handlers}
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <EventSubmissionWindowFields editor={editor} />
        {editor.error && <Alert tone="danger">{editor.error}</Alert>}
      </form>
    </Dialog>
  );
}
