import { useState } from "preact/hooks";
import {
  affiliationReviewApproveSchema,
  type AffiliationReviewApprove,
} from "../../../../shared/schemas/affiliation-reviews";
import { useContractForm } from "../../../hooks/useContractForm";
import { Dialog } from "../../../ui/Dialog";
import { Field } from "../../../ui/Field";
import { Textarea } from "../../../ui/TextControl";

/** A deliberate staff exception, separate from verified domain approval. */
export function AffiliationReviewOverrideDialog({
  personName,
  userId,
  onCancel,
  onConfirm,
}: {
  personName?: string;
  userId?: string;
  onCancel: () => void;
  onConfirm: (activation: NonNullable<AffiliationReviewApprove["activation"]>) => void;
}) {
  const [reason, setReason] = useState("");
  const form = useContractForm(affiliationReviewApproveSchema, { userId, activation: { mode: "immediate", reason } });
  function submit() {
    const checked = form.submit();
    if (checked.data?.activation) onConfirm(checked.data.activation);
  }
  return (
    <Dialog
      open
      title={personName ? `Override verification for ${personName}?` : "Override missing email verification?"}
      description="Confirm the organization affiliation using evidence you reviewed."
      consequences={[
        "Only current work addresses matching an approved organization domain qualify.",
        "An active organization identity is created and the matching reviews are resolved.",
        "The email stays unverified. Your name and reason are recorded in the audit history.",
      ]}
      confirmLabel="Approve with override"
      confirmDisabled={!form.valid}
      onConfirm={submit}
      onCancel={onCancel}
    >
      <form
        noValidate
        {...form.handlers}
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <Field label="Reason for override" required {...form.of("activation.reason")}>
          {(control) => (
            <Textarea
              {...control}
              name="activation.reason"
              value={reason}
              onInput={(event) => setReason(event.currentTarget.value)}
            />
          )}
        </Field>
      </form>
    </Dialog>
  );
}
