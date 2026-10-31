import { useState } from "preact/hooks";
import { identityInvitationManagementSchema } from "../../../shared/schemas/identity-invitation-management";
import { successResponseSchema } from "../../../shared/schemas/api-common";
import { useContractForm } from "../../hooks/useContractForm";
import { postJson } from "../../shared/api-client";
import { Dialog } from "../../ui/Dialog";
import { Field } from "../../ui/Field";
import { Textarea } from "../../ui/TextControl";
import { Alert } from "../../ui/Alert";

export function ActivateIdentityInvitationDialog({
  organizationId,
  identityId,
  userId,
  name,
  onChanged,
  onClose,
}: {
  organizationId: string;
  identityId: string;
  userId: string;
  name: string;
  onChanged: () => Promise<void>;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const form = useContractForm(identityInvitationManagementSchema, { action: "activate", userId, reason });
  async function submit() {
    const checked = form.submit();
    if (!checked.data) return;
    setBusy(true);
    setError("");
    try {
      await postJson(
        `/api/v1/organizations/${encodeURIComponent(organizationId)}/identities/${encodeURIComponent(identityId)}/invitation`,
        checked.data,
        successResponseSchema,
      );
      await onChanged();
      onClose();
    } catch (cause) {
      setError(form.refuse(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      title="Activate representation"
      description={`Activate ${name}'s representation without waiting for invitation acceptance. Record why you are making this exception.`}
      confirmLabel="Activate representation"
      confirmDisabled={busy}
      onConfirm={() => void submit()}
      onCancel={() => {
        if (!busy) onClose();
      }}
    >
      <form
        noValidate
        class="pk-stack"
        {...form.handlers}
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Field label="Reason" required {...form.of("reason")}>
          {(control) => (
            <Textarea {...control} value={reason} onInput={(event) => setReason(event.currentTarget.value)} />
          )}
        </Field>
        {error && <Alert tone="danger">{error}</Alert>}
      </form>
    </Dialog>
  );
}
