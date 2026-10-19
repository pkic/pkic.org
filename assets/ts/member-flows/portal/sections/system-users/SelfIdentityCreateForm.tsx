/**
 * A person creating an identity of their own, in a dialog opened from the
 * Affiliations panel: the organization, the work address that links them to it, and what
 * they do there. It posts to `POST /api/v1/users/current/identities`; the
 * server checks that the chosen verified address belongs to the
 * organization's email domain and refuses anything else on its field.
 */
import { useEffect, useState } from "preact/hooks";
import { ORGANIZATION_JOB_TITLE_COPY } from "../../../../../shared/email-first-copy";
import {
  currentUserIdentityCreateSchema,
  identityMutationResponseSchema,
} from "../../../../../shared/schemas/identity";
import type { PublicMemberSummary } from "../../../../../shared/schemas/members-directory";
import { ownEmailAddressesListResponseSchema } from "../../../../../shared/schemas/own-email-addresses";
import { ServerSearchSelect } from "../../../../components/ServerSearchSelect";
import { useContractForm } from "../../../../hooks/useContractForm";
import { useData } from "../../../../hooks/useData";
import { getJson, postJson } from "../../../../shared/api-client";
import { memberOrganizationCatalog } from "../../../../shared/member-organization-catalog";
import { Alert } from "../../../../ui/Alert";
import { Button } from "../../../../ui/Button";
import { Field } from "../../../../ui/Field";
import { Select, TextInput } from "../../../../ui/TextControl";
import { toast } from "../../ui";
import { OWN_EMAILS_ENDPOINT } from "../email-address-paths";
import { EMAIL_ADDRESSES_ANCHOR } from "./EmailAddressesPanel";

export function SelfIdentityCreateForm({
  onCreated,
  onCancel,
  onBusy,
}: {
  onCreated: () => void;
  /** Closes the hosting dialog; used before leaving for the Email addresses panel. */
  onCancel: () => void;
  /** Reports a save in flight so the dialog's confirm cannot double-submit. */
  onBusy?: (busy: boolean) => void;
}) {
  const [organization, setOrganization] = useState<PublicMemberSummary | null>(null);
  const [emailId, setEmailId] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => onBusy?.(saving), [saving]);
  const addresses = useData(() => getJson(OWN_EMAILS_ENDPOINT, ownEmailAddressesListResponseSchema), []);
  const verified = (addresses.data?.emails ?? []).filter((address) => address.verifiedAt);
  const form = useContractForm(currentUserIdentityCreateSchema, {
    emailId: emailId || null,
    organizationId: organization?.id ?? "",
    jobTitle,
  });

  async function submit(event: Event): Promise<void> {
    event.preventDefault();
    setError("");
    const checked = form.submit();
    if (!checked.data) {
      setError(checked.message);
      return;
    }
    setSaving(true);
    try {
      await postJson("/api/v1/users/current/identities", checked.data, identityMutationResponseSchema);
      toast(`You represent ${organization?.name ?? "the organization"}`, "success");
      onCreated();
    } catch (cause) {
      setError(form.refuse(cause));
    } finally {
      setSaving(false);
    }
  }

  function showEmailAddresses(): void {
    // Leave the dialog first, then bring the panel into view once the page is reachable again.
    onCancel();
    requestAnimationFrame(() => {
      const panel = document.getElementById(EMAIL_ADDRESSES_ANCHOR);
      panel?.scrollIntoView({ block: "center" });
      panel?.querySelector<HTMLElement>("button")?.focus({ preventScroll: true });
    });
  }

  return (
    <form
      noValidate
      class="pk-stack pk-stack--snug"
      aria-label="Add identity"
      {...form.handlers}
      onSubmit={(event) => void submit(event)}
    >
      <Field label="Organization" required {...form.of("organizationId")}>
        {(control) => (
          <ServerSearchSelect
            {...control}
            catalog={memberOrganizationCatalog}
            searchLabel="Organization"
            value={organization?.id ?? null}
            selectedLabel={organization?.name}
            placeholder="Search member organizations…"
            allowEmpty
            onChange={setOrganization}
          />
        )}
      </Field>
      <Field
        label="Work email"
        help="Must be a verified address under the organization's email domain."
        {...form.of("emailId")}
      >
        {(control) => (
          <Select
            {...control}
            name="emailId"
            value={emailId}
            onChange={(event) => setEmailId(event.currentTarget.value)}
          >
            {verified.map((address) => (
              <option key={address.id ?? "primary"} value={address.id ?? ""}>
                {address.email}
                {address.primary ? " (primary)" : ""}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field
        label={ORGANIZATION_JOB_TITLE_COPY.label}
        help={ORGANIZATION_JOB_TITLE_COPY.help}
        required
        {...form.of("jobTitle")}
      >
        {(control) => (
          <TextInput
            {...control}
            name="jobTitle"
            autoComplete="organization-title"
            value={jobTitle}
            onInput={(event) => setJobTitle(event.currentTarget.value)}
          />
        )}
      </Field>
      <p class="pk-small pk-muted">
        An address that does not match the organization cannot link you to it.{" "}
        <Button type="button" variant="link" onClick={showEmailAddresses}>
          Add or verify an address
        </Button>
      </p>
      {error && <Alert tone="danger">{error}</Alert>}
    </form>
  );
}
