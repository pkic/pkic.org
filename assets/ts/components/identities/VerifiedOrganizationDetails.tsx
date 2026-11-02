import { VerifiedOrganizationNameField } from "./VerifiedOrganizationNameField";
import { createPortal } from "preact/compat";
import { useDialogQueryState } from "../../hooks/useDialogQueryState";
import { InputGroup } from "../../ui/InputGroup";
import { Button } from "../../ui/Button";
import { IconPlus } from "../icons";
import { VerifiedOrganizationCreateDialog } from "./VerifiedOrganizationCreateDialog";
import { actingIdentityLabel } from "../../shared/acting-identity-catalog";
import type { z } from "zod";
import { useState, useRef, useEffect } from "preact/hooks";
import {
  identityAffiliationPrepareSchema,
  type identityAffiliationPreviewResponseSchema,
} from "../../../shared/schemas/identity-affiliation";
import { ORGANIZATION_JOB_TITLE_COPY } from "../../../shared/email-first-copy";
import { useContractForm } from "../../hooks/useContractForm";
import { DescriptionList } from "../../ui/DescriptionList";
import { Field } from "../../ui/Field";
import { Select, TextInput } from "../../ui/TextControl";
import { Alert } from "../../ui/Alert";
import { nextDomId } from "../../ui/dom-id";

type Resolved = z.infer<typeof identityAffiliationPreviewResponseSchema>;
type Input = z.infer<typeof identityAffiliationPrepareSchema>;
export interface VerifiedOrganizationController {
  read?: () => { input: Input; contextToken?: string; organizationName: string } | { refused: true };
  validate?: () => boolean;
  prepare?: () => Promise<boolean>;
}
/** One organization confirmation flow, embedded after either session or registration mailbox proof. */
export function VerifiedOrganizationDetails({
  initial,
  emailId,
  resolve,
  prepare,
  controller,
  onDraftChange,
}: {
  initial: Resolved;
  emailId: string | null;
  resolve: (domain?: string) => Promise<Resolved>;
  prepare: (input: Input) => Promise<Resolved>;
  controller: VerifiedOrganizationController;
  onDraftChange?: (draft: { organizationName: string; jobTitle: string }) => void;
}) {
  const [resolved, setResolved] = useState(initial);
  const [organizationId, setOrganizationId] = useState<string | null>(initial.organization?.id ?? null);
  const [organizationName, setOrganizationName] = useState("");
  const [adding, showAdding, closeAdding] = useDialogQueryState("organization");
  const [jobTitle, setJobTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [formId] = useState(() => nextDomId("representation"));
  const prepared = useRef<{ key: string; token?: string; expiresAt: number } | null>(null);
  const selectedDomain = resolved.domains.find((item) => item.domain === resolved.domain);
  const existingJobTitle = resolved.organizations.find((item) => item.id === organizationId)?.jobTitle ?? null;
  const body = {
    phase: "prepare" as const,
    email: resolved.email,
    emailId,
    domain: resolved.domain || undefined,
    organizationId,
    organizationName: organizationId ? undefined : organizationName || undefined,
    jobTitle: existingJobTitle ?? jobTitle,
  };
  const detailsForm = useContractForm(identityAffiliationPrepareSchema, body);
  const key = JSON.stringify(body);
  useEffect(() => {
    onDraftChange?.({
      organizationName: resolved.organizations.find((item) => item.id === organizationId)?.name ?? organizationName,
      jobTitle: existingJobTitle ?? jobTitle,
    });
  }, [key]);
  controller.validate = () => Boolean(detailsForm.submit().data);
  controller.read = () => {
    const checked = identityAffiliationPrepareSchema.safeParse(body);
    return checked.success
      ? {
          input: checked.data,
          organizationName: resolved.organizations.find((item) => item.id === organizationId)?.name ?? organizationName,
          contextToken: prepared.current?.key === key ? prepared.current.token : undefined,
        }
      : { refused: true };
  };
  controller.prepare = async () => {
    const checked = detailsForm.submit();
    if (!checked.data) return false;
    if (prepared.current?.key === key && prepared.current.token && prepared.current.expiresAt > Date.now()) return true;
    setBusy(true);
    setError("");
    try {
      const result = await prepare(checked.data);
      prepared.current = { key, token: result.contextToken, expiresAt: Date.now() + 90_000 };
      return true;
    } catch (cause) {
      setError(detailsForm.refuse(cause));
      return false;
    } finally {
      setBusy(false);
    }
  };
  async function changeDomain(
    domain: string,
    keepNewOrganization = organizationId === null && Boolean(organizationName),
  ) {
    setBusy(true);
    setError("");
    try {
      const result = await resolve(domain);
      setResolved(result);
      setOrganizationId(keepNewOrganization ? null : (result.organization?.id ?? null));
    } catch (cause) {
      setError(detailsForm.refuse(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div class="pk-stack" {...detailsForm.handlers}>
      <input
        type="hidden"
        name="representationLabel"
        value={actingIdentityLabel({
          organizationName: resolved.organizations.find((item) => item.id === organizationId)?.name ?? organizationName,
          jobTitle: existingJobTitle ?? jobTitle,
        })}
      />
      {resolved && resolved.domains.length > 1 && (
        <Field
          label="Email domain"
          help={
            selectedDomain?.canLink
              ? `Future verified email addresses at ${resolved.domain} will link to this organization.`
              : selectedDomain?.organizationName
                ? `Already linked to ${selectedDomain.organizationName}.`
                : `Your work email was verified for ${resolved.domain}.`
          }
          {...detailsForm.of("domain")}
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
      {resolved.organizations.length === 0 ? (
        <VerifiedOrganizationNameField
          domain={resolved.domain}
          reviewRequired={resolved.reviewRequired}
          value={organizationName}
          disabled={busy}
          onChange={setOrganizationName}
          validation={detailsForm.of("organizationName")}
        />
      ) : (
        <Field
          label="Organization"
          required
          help={
            resolved.domain
              ? `Organizations linked to your verified email domain, ${resolved.domain}, and organizations you already represent using this address are listed. Use + to add your organization if it is missing.`
              : "Use + to add your organization."
          }
          {...detailsForm.of(organizationId ? "organizationId" : "organizationName")}
        >
          {(control) => (
            <InputGroup>
              <Select
                {...control}
                value={organizationId ?? ""}
                disabled={busy}
                onChange={(event) => setOrganizationId(event.currentTarget.value || null)}
              >
                {resolved.organizations.map((organization) => (
                  <option key={organization.id} value={organization.id}>
                    {organization.name}
                  </option>
                ))}
                <option value="" disabled={!organizationName}>
                  {organizationName || "Choose an organization"}
                </option>
              </Select>
              <Button
                type="button"
                variant="secondary"
                icon
                aria-label="Add organization"
                title="Add organization"
                onClick={showAdding}
              >
                <IconPlus />
              </Button>
            </InputGroup>
          )}
        </Field>
      )}
      {resolved.organizations.length > 0 &&
        createPortal(
          <VerifiedOrganizationCreateDialog
            initial={resolved}
            open={adding}
            resolve={resolve}
            onClose={() => void closeAdding()}
            onUse={(organization) => {
              setResolved(organization.resolved);
              setOrganizationId(null);
              setOrganizationName(organization.name);
              void closeAdding();
            }}
          />,
          document.body,
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
    </div>
  );
}
