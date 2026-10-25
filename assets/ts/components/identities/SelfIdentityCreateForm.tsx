/**
 * A person creating an identity of their own, in a dialog opened from the
 * Affiliations panel: the organization, the work address that links them to it, and what
 * they do there. It posts to `POST /api/v1/users/current/identities`; the
 * server checks that the chosen verified address belongs to the
 * organization's email domain and refuses anything else on its field.
 */
import type { ComponentChildren } from "preact";
import type { z } from "zod";
import { useEffect, useState } from "preact/hooks";
import { ORGANIZATION_JOB_TITLE_COPY } from "../../../shared/email-first-copy";
import { currentUserIdentityCreateSchema, identityMutationResponseSchema } from "../../../shared/schemas/identity";
import type { PublicMemberSummary } from "../../../shared/schemas/members-directory";
import { ownEmailAddressesListResponseSchema } from "../../../shared/schemas/own-email-addresses";
import { affiliationOfferResponseSchema } from "../../../shared/schemas/affiliation-offer";
import { ServerSearchSelect } from "../ServerSearchSelect";
import { useContractForm } from "../../hooks/useContractForm";
import { useData } from "../../hooks/useData";
import { getJson, postJson } from "../../shared/api-client";
import { memberOrganizationCatalog } from "../../shared/member-organization-catalog";
import { Alert } from "../../ui/Alert";
import { Field } from "../../ui/Field";
import { Select, TextInput } from "../../ui/TextControl";
import { showToast } from "../../shared/toast";
import { OWN_EMAILS_ENDPOINT } from "../../shared/email-address-paths";

export function SelfIdentityCreateForm({
  onCreated,
  emailAddressAction,
  onBusy,
}: {
  onCreated: (result: z.infer<typeof identityMutationResponseSchema>) => void | Promise<void>;
  /** The host decides how to reach email management without losing its draft. */
  emailAddressAction: ComponentChildren;
  /** Reports a save in flight so the dialog's confirm cannot double-submit. */
  onBusy?: (busy: boolean) => void;
}) {
  // The same form can be hosted by independently mounted portal and public roots.
  const [formId] = useState(() => `identity-${crypto.randomUUID()}`);
  const [organization, setOrganization] = useState<Pick<PublicMemberSummary, "id" | "name"> | null>(null);
  const [emailId, setEmailId] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => onBusy?.(saving), [saving]);
  const addresses = useData(() => getJson(OWN_EMAILS_ENDPOINT, ownEmailAddressesListResponseSchema), []);
  const suggestion = useData(
    () => getJson("/api/v1/users/current/identities/offer", affiliationOfferResponseSchema),
    [],
  );
  useEffect(() => {
    const offer = suggestion.data?.offer;
    if (offer?.kind === "organization") {
      setOrganization(offer.organization);
      setEmailId(offer.emailId ?? "");
    }
  }, [suggestion.data]);
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
      const result = await postJson("/api/v1/users/current/identities", checked.data, identityMutationResponseSchema);
      showToast("portal-toast-area", `You represent ${organization?.name ?? "the organization"}`, "success");
      await onCreated(result);
    } catch (cause) {
      setError(form.refuse(cause));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      noValidate
      class="pk-stack pk-stack--snug"
      aria-label="Add identity"
      {...form.handlers}
      onSubmit={(event) => void submit(event)}
    >
      <Field id={`${formId}-organization`} label="Organization" required {...form.of("organizationId")}>
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
        id={`${formId}-email`}
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
        id={`${formId}-job-title`}
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
        An address that does not match the organization cannot link you to it. {emailAddressAction}
      </p>
      {error && <Alert tone="danger">{error}</Alert>}
    </form>
  );
}
