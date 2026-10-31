import type { z } from "zod";
import { useMemo, useState } from "preact/hooks";
import {
  representationEmailChangeSchema,
  representationEmailOptionsResponseSchema,
} from "../../../shared/schemas/representation-email";
import { successResponseSchema } from "../../../shared/schemas/api-common";
import { useContractForm } from "../../hooks/useContractForm";
import { putJson } from "../../shared/api-client";
import { ServerSearchSelect } from "../ServerSearchSelect";
import { Alert } from "../../ui/Alert";
import { Dialog } from "../../ui/Dialog";
import { Field } from "../../ui/Field";

/** One verified-address correction for owners and staff; account sign-in is a separate choice. */
export function RepresentationEmailDialog({
  userId,
  source,
  open,
  onClose,
  onChanged,
}: {
  userId: string;
  source: { identityId: string; emailId: string | null; email: string; organizationName: string | null };
  open: boolean;
  onClose: () => void;
  onChanged: () => void | Promise<void>;
}) {
  const [selection, setSelection] = useState({ id: source.emailId, email: source.email });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const endpoint = `/api/v1/users/${encodeURIComponent(userId)}/identities/${encodeURIComponent(source.identityId)}/email`;
  const form = useContractForm(representationEmailChangeSchema, {
    previousEmailId: source.emailId,
    emailId: selection.id,
  });
  const catalog = useMemo(
    () => ({
      endpoint,
      responseSchema: representationEmailOptionsResponseSchema,
      resolveItems: (data: z.infer<typeof representationEmailOptionsResponseSchema>) => data.emails,
      resolvePage: (data: z.infer<typeof representationEmailOptionsResponseSchema>) => data.page,
      itemKey: (email: { id: string | null }) => email.id ?? "primary",
      itemLabel: (email: { email: string }) => email.email,
      sort: "email",
    }),
    [endpoint],
  );
  async function submit() {
    const checked = form.submit();
    if (!checked.data) return;
    setBusy(true);
    setError("");
    try {
      await putJson(endpoint, checked.data, successResponseSchema);
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
      open={open}
      title="Change representation email"
      description={`Choose a verified email address for the representation of ${source.organizationName ?? "this organization"}. The organization, role, and group seats stay the same.`}
      closeLabel="Close representation email"
      confirmLabel="Save email"
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
        <Field label="Representation email" required {...form.of("emailId")}>
          {(control) => (
            <ServerSearchSelect
              {...control}
              catalog={catalog}
              searchable={false}
              allowEmpty={false}
              searchLabel="Verified email addresses"
              value={selection.id ?? "primary"}
              selectedLabel={selection.email}
              onChange={(email) => {
                if (email) setSelection({ id: email.id, email: email.email });
              }}
            />
          )}
        </Field>
        {error && <Alert tone="danger">{error}</Alert>}
      </form>
    </Dialog>
  );
}
