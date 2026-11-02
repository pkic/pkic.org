import { VerifiedOrganizationNameField } from "./VerifiedOrganizationNameField";
/** The existing verified name/domain step, opened from the shared select-and-add control. */
import { useState, useEffect, useRef } from "preact/hooks";
import type { z } from "zod";
import {
  identityAffiliationPrepareBaseSchema,
  type identityAffiliationPreviewResponseSchema,
} from "../../../shared/schemas/identity-affiliation";
import { useContractForm } from "../../hooks/useContractForm";
import { Dialog } from "../../ui/Dialog";
import { Field } from "../../ui/Field";
import { Select } from "../../ui/TextControl";
import { Alert } from "../../ui/Alert";

type Resolved = z.infer<typeof identityAffiliationPreviewResponseSchema>;
const organizationFields = identityAffiliationPrepareBaseSchema
  .pick({ organizationName: true, domain: true })
  .required({ organizationName: true });
export function VerifiedOrganizationCreateDialog({
  initial,
  open,
  resolve,
  onUse,
  onClose,
}: {
  initial: Resolved;
  open: boolean;
  resolve: (domain?: string) => Promise<Resolved>;
  onUse: (organization: { name: string; resolved: Resolved }) => void;
  onClose: () => void;
}) {
  const [resolved, setResolved] = useState(initial);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const active = useRef(true);
  useEffect(
    () => () => {
      active.current = false;
    },
    [],
  );
  const form = useContractForm(organizationFields, { organizationName: name, domain: resolved.domain || undefined });
  async function changeDomain(domain: string) {
    setBusy(true);
    setError("");
    try {
      const result = await resolve(domain);
      if (active.current) setResolved(result);
    } catch (cause) {
      if (active.current) setError(form.refuse(cause));
    } finally {
      if (active.current) setBusy(false);
    }
  }
  const initialized = useRef(false);
  useEffect(() => {
    if (!open) {
      setResolved(initial);
      initialized.current = false;
    }
  }, [initial.domain]);
  useEffect(() => {
    if (!open || initialized.current) return;
    initialized.current = true;
    const specific = initial.domains.find((item) => item.canLink);
    if (specific && specific.domain !== initial.domain) void changeDomain(specific.domain);
  }, [open]);
  function useOrganization() {
    if (busy) return;
    const checked = form.submit();
    if (!checked.data) return;
    onUse({ name: checked.data.organizationName, resolved });
  }
  return (
    <Dialog
      open={open}
      title="Add organization"
      closeLabel="Close add organization"
      confirmLabel="Use organization"
      confirmDisabled={busy}
      onConfirm={useOrganization}
      onCancel={onClose}
    >
      <form
        noValidate
        class="pk-stack"
        {...form.handlers}
        onSubmit={(event) => {
          event.preventDefault();
          useOrganization();
        }}
      >
        {resolved.domains.length > 1 && (
          <Field
            label="Email domain"
            help="Choose which verified email domain this organization is associated with."
            {...form.of("domain")}
          >
            {(control) => (
              <Select
                {...control}
                value={resolved.domain}
                disabled={busy}
                onChange={(event) => void changeDomain(event.currentTarget.value)}
              >
                {resolved.domains.map((item) => (
                  <option key={item.domain} value={item.domain}>
                    {item.domain}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        <VerifiedOrganizationNameField
          domain={resolved.domain}
          value={name}
          disabled={busy}
          onChange={setName}
          validation={form.of("organizationName")}
        />
        {error && <Alert tone="danger">{error}</Alert>}
      </form>
    </Dialog>
  );
}
