import { VerifiedOrganizationNameField } from "./VerifiedOrganizationNameField";
/** The existing verified name/domain step, opened from the shared select-and-add control. */
import { useState, useEffect, useRef, useCallback } from "preact/hooks";
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
  .required({ organizationName: true, domain: true });
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
  const [chosenDomain, setChosenDomain] = useState(initial.domains.length > 1 ? "" : initial.domain);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const active = useRef(true);
  const request = useRef(0);
  useEffect(
    () => () => {
      active.current = false;
    },
    [],
  );
  const form = useContractForm(organizationFields, { organizationName: name, domain: chosenDomain });
  const refuse = form.refuse;
  const changeDomain = useCallback(
    async (domain: string) => {
      const currentRequest = ++request.current;
      setBusy(true);
      setError("");
      try {
        const result = await resolve(domain);
        if (active.current && request.current === currentRequest) {
          setResolved(result);
          setChosenDomain(domain);
        }
      } catch (cause) {
        if (active.current && request.current === currentRequest) setError(refuse(cause));
      } finally {
        if (active.current && request.current === currentRequest) setBusy(false);
      }
    },
    [resolve, refuse],
  );
  useEffect(() => {
    if (!open) {
      request.current++;
      setBusy(false);
      setResolved(initial);
      setChosenDomain(initial.domains.length > 1 ? "" : initial.domain);
    }
  }, [initial, open]);
  function selectOrganization() {
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
      onConfirm={selectOrganization}
      onCancel={onClose}
    >
      <form
        noValidate
        class="pk-stack"
        {...form.handlers}
        onSubmit={(event) => {
          event.preventDefault();
          selectOrganization();
        }}
      >
        {resolved.domains.length > 1 && (
          <Field
            label="Email domain"
            required
            help="Is a subdomain dedicated to this organization? Choose the domain to link to it."
            {...form.of("domain")}
          >
            {(control) => (
              <Select
                {...control}
                value={chosenDomain}
                disabled={busy}
                onChange={(event) => {
                  if (event.currentTarget.value) void changeDomain(event.currentTarget.value);
                }}
              >
                <option value="">Choose an email domain</option>
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
          domain={chosenDomain}
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
