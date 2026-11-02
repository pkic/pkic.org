import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import type { z } from "zod";
import { eventProposalIdentityJobTitlePatchSchema } from "../../shared/schemas/event-proposal-proof";
import { ORGANIZATION_JOB_TITLE_COPY } from "../../shared/email-first-copy";
import { useContractForm } from "../hooks/useContractForm";
import { Alert } from "../ui/Alert";
import { Button } from "../ui/Button";
import { Field } from "../ui/Field";
import { FormSection } from "../ui/FormSection";
import { TextInput } from "../ui/TextControl";
import { ParticipationIdentitySummary } from "./ParticipationIdentitySummary";
import type { ParticipationPerson } from "./useProposalEntryIdentity";

export type RepresentationRolePatch = z.infer<typeof eventProposalIdentityJobTitlePatchSchema>;

const REPRESENTATION_JOB_TITLE_MISSING =
  "This representation has no job title yet. Add yours to take part on behalf of this organization.";

/** Updating your role never changes the shared organization or another representation. */
export function ParticipationRepresentation({
  person,
  save,
  savedMessage,
  available = true,
  requireJobTitle = false,
  children,
}: {
  person: ParticipationPerson;
  save?: (role: RepresentationRolePatch) => Promise<void>;
  savedMessage?: string;
  available?: boolean;
  /** Taking part on behalf of the organization: a representation without a job title opens for one. */
  requireJobTitle?: boolean;
  children?: ComponentChildren;
}) {
  const missingJobTitle = requireJobTitle && available && Boolean(save) && !person.jobTitle;
  const [editing, setEditing] = useState(missingJobTitle);
  const [jobTitle, setJobTitle] = useState(person.jobTitle ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const form = useContractForm(eventProposalIdentityJobTitlePatchSchema, { jobTitle });
  async function submit(): Promise<void> {
    const checked = form.submit();
    if (!checked.data || !save) {
      setError(checked.formMessage);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await save(checked.data);
      setEditing(false);
      setSaved(true);
    } catch (failure) {
      setError(form.refuse(failure));
    } finally {
      setSaving(false);
    }
  }
  return (
    <div
      class="pk-stack"
      {...form.handlers}
      onKeyDown={(event) => {
        if (editing && event.key === "Enter" && event.target instanceof HTMLInputElement) {
          event.preventDefault();
          if (!saving) void submit();
        }
      }}
    >
      <FormSection
        layout="stack"
        title={editing ? "Update current representation" : "Your representation for this proposal"}
        description={missingJobTitle && editing ? REPRESENTATION_JOB_TITLE_MISSING : undefined}
      >
        {available ? (
          <ParticipationIdentitySummary
            person={{ ...person, jobTitle: editing ? null : person.jobTitle }}
            knownOnly
            scope="representation"
          />
        ) : (
          <p class="pk-muted">The current representation is unavailable. Your recorded appearance stays unchanged.</p>
        )}
        {editing ? (
          <>
            <Field
              label={ORGANIZATION_JOB_TITLE_COPY.label}
              help={`${ORGANIZATION_JOB_TITLE_COPY.help} The organization and email address stay unchanged.`}
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
            <div class="pk-cluster">
              <Button type="button" loading={saving} onClick={() => void submit()}>
                Save representation
              </Button>
              <Button type="button" variant="secondary" disabled={saving} onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </div>
          </>
        ) : (
          <>
            {available && save && (
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setJobTitle(person.jobTitle ?? "");
                  setError(null);
                  setSaved(false);
                  form.reset();
                  setEditing(true);
                }}
              >
                Update current representation
              </Button>
            )}
            {children}
          </>
        )}
      </FormSection>
      {error && <Alert tone="danger">{error}</Alert>}
      {saved && savedMessage && <p role="status">{savedMessage}</p>}
    </div>
  );
}
