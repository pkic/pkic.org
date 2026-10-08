import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import type { z } from "zod";
import { eventProposalIdentityJobTitlePatchSchema } from "../../shared/schemas/event-proposal-proof";
import { useContractForm } from "../hooks/useContractForm";
import { Alert } from "../ui/Alert";
import { Button } from "../ui/Button";
import { Field } from "../ui/Field";
import { FormSection } from "../ui/FormSection";
import { TextInput } from "../ui/TextControl";
import { ParticipationIdentitySummary } from "./ParticipationIdentitySummary";
import type { ParticipationPerson } from "./useProposalEntryIdentity";

export type RepresentationRolePatch = z.infer<typeof eventProposalIdentityJobTitlePatchSchema>;

/** Updating your role never changes the shared organization or another representation. */
export function ParticipationRepresentation({
  person,
  save,
  savedMessage,
  available = true,
  children,
}: {
  person: ParticipationPerson;
  save?: (role: RepresentationRolePatch) => Promise<void>;
  savedMessage?: string;
  available?: boolean;
  children?: ComponentChildren;
}) {
  const [editing, setEditing] = useState(false);
  const [jobTitle, setJobTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const form = useContractForm(eventProposalIdentityJobTitlePatchSchema, { jobTitle: jobTitle.trim() || null });
  async function submit(): Promise<void> {
    const checked = form.submit();
    if (!checked.data || !save) {
      setError(checked.message);
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
              label="Job title (optional)"
              help="Leave this blank to remove your current job title. The organization and email address stay unchanged."
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
