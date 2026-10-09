/**
 * The attendee manage page's read view: what the registration says, the
 * command that opens the form, and — apart from both — the two whole-record
 * decisions an attendee can take.
 *
 * The page used to open on its form with "Save changes", "Cancel
 * registration" and "I did not request this registration" in one row, where
 * "Cancel registration" read as "leave without saving". Editing is now an
 * explicit command, and the destructive commands sit in their own section and
 * confirm in the shared dialog, as the portal's registration page does.
 */
import type { RegistrationManageReadResponse } from "../../shared/schemas/registration";
import type { EventFormsResponse } from "../shared/types";
import { ConfirmDialogHost } from "../components/ConfirmDialog";
import { ParticipantRegistrationDetails } from "../components/events/ParticipantRegistrationDetails";
import { Button } from "../ui/Button";

export function RegistrationManageSummary({
  data,
  form,
  editable,
  dialogHost,
  onEdit,
  onCancel,
  onReport,
}: {
  data: RegistrationManageReadResponse;
  form: EventFormsResponse["form"];
  /** False once the registration is cancelled: there is nothing left to change or cancel. */
  editable: boolean;
  /** Whether this view must render the page's confirmation host itself. */
  dialogHost: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onReport: () => void;
}) {
  return (
    <div class="pk-stack pk-stack--loose">
      <section class="pk-stack pk-stack--snug" aria-label="Your details">
        <h3>Your details</h3>
        <ParticipantRegistrationDetails data={data} form={form} daysSummarized={false} />
        {editable && (
          <div class="pk-cluster">
            <Button type="button" variant="secondary" onClick={onEdit}>
              Edit details
            </Button>
          </div>
        )}
      </section>
      {editable && (
        <section class="pk-stack pk-stack--snug" aria-label="Cancel or report this registration">
          <h3>Cancel or report this registration</h3>
          <div class="pk-cluster">
            <Button type="button" variant="danger-quiet" onClick={onCancel}>
              Cancel my registration…
            </Button>
            <Button type="button" variant="danger-quiet" onClick={onReport}>
              I did not request this registration…
            </Button>
          </div>
        </section>
      )}
      {dialogHost && <ConfirmDialogHost />}
    </div>
  );
}
