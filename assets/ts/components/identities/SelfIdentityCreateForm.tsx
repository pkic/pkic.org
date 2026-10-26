/** Email-first representation onboarding: production mailbox proof, followed by the canonical domain rule. */
import type { z } from "zod";
import { useEffect, useState } from "preact/hooks";
import { ORGANIZATION_JOB_TITLE_COPY } from "../../../shared/email-first-copy";
import { currentUserIdentityCreateSchema, identityMutationResponseSchema } from "../../../shared/schemas/identity";
import {
  identityAffiliationPrepareSchema,
  identityAffiliationPreviewSchema,
  identityAffiliationPreviewResponseSchema,
} from "../../../shared/schemas/identity-affiliation";
import {
  ownRepresentationEmailAddSchema,
  ownEmailVerificationRequestedResponseSchema,
  ownEmailAddressesListResponseSchema,
  type OwnEmailAddress,
} from "../../../shared/schemas/own-email-addresses";
import { useContractForm } from "../../hooks/useContractForm";
import { getJson, postJson } from "../../shared/api-client";
import { OWN_EMAILS_ENDPOINT } from "../../shared/email-address-paths";
import { Alert } from "../../ui/Alert";
import { Field } from "../../ui/Field";
import { Select, TextInput } from "../../ui/TextControl";
import { Button } from "../../ui/Button";
import { DescriptionList } from "../../ui/DescriptionList";
import { EmailAddressCreateForm } from "./EmailAddressCreateForm";
import { nextDomId } from "../../ui/dom-id";

const PREVIEW_ENDPOINT = "/api/v1/users/current/identities/preview";
type Resolved = z.infer<typeof identityAffiliationPreviewResponseSchema>;
export function SelfIdentityCreateForm({
  onCreated,
  onBusy,
  onActionLabel,
}: {
  onCreated: (result: z.infer<typeof identityMutationResponseSchema>) => void | Promise<void>;
  onBusy?: (busy: boolean) => void;
  onActionLabel?: (label: string) => void;
}) {
  const [stage, setStage] = useState<"email" | "waiting" | "details">("email");
  const [email, setEmail] = useState("");
  const [individual, setIndividual] = useState(false);
  const [address, setAddress] = useState<Pick<OwnEmailAddress, "id" | "email"> | null>(null);
  const [resolved, setResolved] = useState<Resolved | null>(null);
  const [organizationName, setOrganizationName] = useState("");
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [jobTitle, setJobTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [formId] = useState(() => nextDomId("identity"));
  useEffect(() => onBusy?.(busy), [busy]);
  useEffect(
    () =>
      onActionLabel?.(
        stage === "email" ? "Continue" : stage === "waiting" ? "Check verification" : "Add representation",
      ),
    [stage],
  );
  const proofForm = useContractForm(identityAffiliationPreviewSchema, {
    phase: "resolve",
    email,
    emailId: address?.id ?? null,
    unaffiliatedAttestation: individual,
  });
  const selectedOrganization = resolved?.organizations.find((item) => item.id === organizationId);
  const existingJobTitle = selectedOrganization?.identityId ? selectedOrganization.jobTitle : null;
  const detailsForm = useContractForm(identityAffiliationPrepareSchema, {
    phase: "prepare",
    email,
    emailId: address?.id ?? null,
    organizationId,
    organizationName: organizationId ? undefined : organizationName || undefined,
    jobTitle: existingJobTitle ?? jobTitle,
  });
  async function ownAddresses() {
    return (await getJson(OWN_EMAILS_ENDPOINT, ownEmailAddressesListResponseSchema)).emails;
  }
  async function resolve(value: Pick<OwnEmailAddress, "id" | "email">, contract = proofForm) {
    const result = await postJson(
      PREVIEW_ENDPOINT,
      identityAffiliationPreviewSchema.parse({
        phase: "resolve",
        email: value.email,
        emailId: value.id,
        unaffiliatedAttestation: individual,
      }),
      identityAffiliationPreviewResponseSchema,
    );
    setAddress(value);
    setEmail(value.email);
    setResolved(result);
    setOrganizationId(result.organization?.id ?? null);
    setError("");
    contract.reset();
    if (individual && result.identityId)
      await onCreated({ success: true, identityId: result.identityId, state: "active" });
    else setStage("details");
  }
  if (stage === "email")
    return (
      <EmailAddressCreateForm
        isSelf
        embedded
        onIndividualChange={setIndividual}
        onBusy={setBusy}
        beforeAdd={async (value) => {
          let handled = false;
          try {
            const existing = (await ownAddresses()).find((item) => item.email.toLowerCase() === value.toLowerCase());
            if (!existing) return false;
            handled = true;
            setAddress(existing);
            setEmail(existing.email);
            if (existing.verifiedAt) await resolve(existing);
            else {
              await postJson(
                OWN_EMAILS_ENDPOINT,
                ownRepresentationEmailAddSchema.parse({
                  email: value,
                  purpose: "representation",
                  unaffiliatedAttestation: individual,
                }),
                ownEmailVerificationRequestedResponseSchema,
              );
              setStage("waiting");
            }
            return true;
          } finally {
            if (handled) setBusy(false);
          }
        }}
        onAdded={(value) => {
          setEmail(value);
          setStage("waiting");
          setBusy(false);
        }}
      />
    );
  if (stage === "waiting")
    return (
      <form
        noValidate
        class="pk-stack"
        {...proofForm.handlers}
        onSubmit={async (event) => {
          event.preventDefault();
          if (busy) return;
          const checked = proofForm.submit();
          if (!checked.data) return setError(checked.message);
          setBusy(true);
          setError("");
          try {
            const current = (await ownAddresses()).find((item) => item.email.toLowerCase() === email.toLowerCase());
            await resolve(current ?? { id: null, email });
          } catch (cause) {
            setError(proofForm.refuse(cause));
          } finally {
            setBusy(false);
          }
        }}
      >
        <p>
          Open the verification email sent to <strong>{email}</strong> and confirm the address. Then return here.
        </p>
        {error && <Alert tone="danger">{error}</Alert>}
        <Button
          variant="link"
          loading={busy}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              await postJson(
                OWN_EMAILS_ENDPOINT,
                ownRepresentationEmailAddSchema.parse({
                  email,
                  purpose: "representation",
                  unaffiliatedAttestation: individual,
                }),
                ownEmailVerificationRequestedResponseSchema,
              );
            } catch (cause) {
              setError(proofForm.refuse(cause));
            } finally {
              setBusy(false);
            }
          }}
        >
          Resend verification email
        </Button>
        <Button
          variant="link"
          onClick={() => {
            setStage("email");
            setError("");
          }}
        >
          Use another email
        </Button>
      </form>
    );
  return (
    <form
      noValidate
      class="pk-stack"
      {...detailsForm.handlers}
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy) return;
        const checked = detailsForm.submit();
        if (!checked.data) return setError(checked.message);
        setBusy(true);
        setError("");
        try {
          const prepared = await postJson(PREVIEW_ENDPOINT, checked.data, identityAffiliationPreviewResponseSchema);
          const result = await postJson(
            "/api/v1/users/current/identities",
            currentUserIdentityCreateSchema.parse({ contextToken: prepared.contextToken }),
            identityMutationResponseSchema,
          );
          await onCreated(result);
        } catch (cause) {
          setError(detailsForm.refuse(cause));
        } finally {
          setBusy(false);
        }
      }}
    >
      <DescriptionList items={[{ term: "Verified representation email", value: email }]} />
      {Boolean(resolved?.organizations.length) && (
        <Field
          label="Organization"
          help="Confirm which organization you represent. Organizations can share an email domain."
          required
          {...detailsForm.of("organizationId")}
        >
          {(control) => (
            <Select
              {...control}
              value={organizationId ?? ""}
              onChange={(event) => setOrganizationId(event.currentTarget.value || null)}
            >
              {resolved!.organizations.map((organization) => (
                <option key={organization.id} value={organization.id}>
                  {organization.name}
                </option>
              ))}
              <option value="">Another organization</option>
            </Select>
          )}
        </Field>
      )}
      {!organizationId && (
        <Field id={`${formId}-organization`} label="Organization name" required {...detailsForm.of("organizationName")}>
          {(control) => (
            <TextInput
              {...control}
              name="organizationName"
              autoComplete="organization"
              value={organizationName}
              onInput={(event) => setOrganizationName(event.currentTarget.value)}
            />
          )}
        </Field>
      )}
      {existingJobTitle ? (
        <DescriptionList items={[{ term: "Job title", value: existingJobTitle }]} />
      ) : (
        <Field
          id={`${formId}-title`}
          label={ORGANIZATION_JOB_TITLE_COPY.label}
          help={ORGANIZATION_JOB_TITLE_COPY.help}
          required
          {...detailsForm.of("jobTitle")}
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
      )}
      {error && <Alert tone="danger">{error}</Alert>}
      <Button
        variant="link"
        onClick={() => {
          setStage("email");
          setError("");
        }}
      >
        Use another email
      </Button>
    </form>
  );
}
