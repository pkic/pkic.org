/** Staff-created organization identity; membership is a separate operation. */
import { useEffect, useState } from "preact/hooks";
import type { z } from "zod";
import type { OrganizationSummary } from "../../../shared/schemas/organization-management";
import { identityMutationResponseSchema } from "../../../shared/schemas/identity";
import { organizationIdentityCreateRequestSchema } from "../../../shared/schemas/route-contracts-identities";
import { ORGANIZATION_JOB_TITLE_COPY } from "../../../shared/email-first-copy";
import { adminOrganizationCatalog } from "../../shared/management-catalogs";
import { useContractForm } from "../../hooks/useContractForm";
import { postJson } from "../../shared/api-client";
import { showToast } from "../../shared/toast";
import { ServerSearchSelect } from "../ServerSearchSelect";
import { Alert } from "../../ui/Alert";
import { Checkbox } from "../../ui/Checkbox";
import { Field } from "../../ui/Field";
import { TextInput } from "../../ui/TextControl";

export function ManagedIdentityCreateForm({
  userId,
  canActivate,
  preferImmediateActivation = false,
  onCreated,
  onBusy,
}: {
  userId: string;
  canActivate: boolean;
  preferImmediateActivation?: boolean;
  onCreated: (result: z.infer<typeof identityMutationResponseSchema>) => void | Promise<void>;
  onBusy: (busy: boolean) => void;
}) {
  const [organization, setOrganization] = useState<OrganizationSummary | null>(null);
  const [jobTitle, setJobTitle] = useState("");
  const [immediate, setImmediate] = useState(canActivate && preferImmediateActivation);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => onBusy(busy), [busy, onBusy]);
  const form = useContractForm(organizationIdentityCreateRequestSchema, {
    organizationId: organization?.id ?? "",
    userReference: "existing_user",
    userId,
    jobTitle,
    showOnOrganizationProfile: true,
    activation: immediate ? { mode: "immediate", reason } : { mode: "invitation" },
  });
  async function submit(event: Event) {
    event.preventDefault();
    const checked = form.submit();
    if (!checked.data) return;
    setError("");
    setBusy(true);
    try {
      const { organizationId, ...body } = checked.data;
      const result = await postJson(
        `/api/v1/organizations/${encodeURIComponent(organizationId)}/identities`,
        body,
        identityMutationResponseSchema,
      );
      showToast("portal-toast-area", immediate ? "Identity added" : "Identity invitation sent", "success");
      await onCreated(result);
    } catch (cause) {
      const message = form.refuse(cause);
      setError(message);
      showToast("portal-toast-area", message, "error");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-label="Add identity">
      <form noValidate class="pk-stack pk-stack--snug" {...form.handlers} onSubmit={(event) => void submit(event)}>
        <Field label="Organization" required {...form.of("organizationId")}>
          {(control) => (
            <ServerSearchSelect
              {...control}
              catalog={adminOrganizationCatalog}
              searchLabel="Organization"
              value={organization?.id ?? null}
              selectedLabel={organization?.name}
              placeholder="Search organizations…"
              onChange={setOrganization}
            />
          )}
        </Field>
        <Field
          label={ORGANIZATION_JOB_TITLE_COPY.label}
          help="Their role at this organization, shown with their name."
          required
          {...form.of("jobTitle")}
        >
          {(control) => (
            <TextInput
              {...control}
              name="jobTitle"
              value={jobTitle}
              onInput={(event) => setJobTitle(event.currentTarget.value)}
            />
          )}
        </Field>
        {canActivate && (
          <Checkbox
            id="identity-activate-immediately"
            checked={immediate}
            onChange={(event) => setImmediate(event.currentTarget.checked)}
            label="Activate immediately"
            hint="Otherwise, the user must accept the invitation."
          />
        )}
        {immediate && organization && (
          <Alert tone="warn">
            Confirm that this person represents {organization.name}, even if their email domain differs.
          </Alert>
        )}
        {immediate && (
          <Field label="Activation reason" required {...form.of("activation")}>
            {(control) => (
              <TextInput
                {...control}
                name="activation"
                value={reason}
                onInput={(event) => setReason(event.currentTarget.value)}
              />
            )}
          </Field>
        )}
        {error && <Alert tone="danger">{error}</Alert>}
      </form>
    </section>
  );
}
