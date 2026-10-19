import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import type { z } from "zod";
import { eventProposalPersonNamePatchSchema } from "../../shared/schemas/event-proposal-proof";
import { useContractForm } from "../hooks/useContractForm";
import { Alert } from "../ui/Alert";
import { Button } from "../ui/Button";
import { Field } from "../ui/Field";
import { FormSection } from "../ui/FormSection";
import { TextInput } from "../ui/TextControl";
import { ParticipationIdentitySummary } from "./ParticipationIdentitySummary";
import type { ParticipationPerson } from "./useProposalEntryIdentity";

export type PersonalNamePatch = z.infer<typeof eventProposalPersonNamePatchSchema>;

/** Editing your stored name is separate from choosing an organization representation. */
export function ParticipationPersonalDetails({
  person,
  save,
  description,
  children,
}: {
  person: ParticipationPerson;
  description?: string;
  children?: ComponentChildren;
  save?: (names: PersonalNamePatch) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const form = useContractForm(eventProposalPersonNamePatchSchema, { firstName, lastName });
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
    } catch (failure) {
      setError(form.refuse(failure));
    } finally {
      setSaving(false);
    }
  }
  return editing ? (
    <div
      class="pk-stack"
      {...form.handlers}
      onKeyDown={(event) => {
        if (event.key === "Enter" && event.target instanceof HTMLInputElement) {
          event.preventDefault();
          if (!saving) void submit();
        }
      }}
    >
      <FormSection
        title="Edit my details"
        description="These changes update your stored personal details. Your representations stay unchanged."
      >
        <Field label="First name" {...form.of("firstName")}>
          {(control) => (
            <TextInput
              {...control}
              name="firstName"
              value={firstName}
              onInput={(event) => setFirstName(event.currentTarget.value)}
            />
          )}
        </Field>
        <Field label="Last name" {...form.of("lastName")}>
          {(control) => (
            <TextInput
              {...control}
              name="lastName"
              value={lastName}
              onInput={(event) => setLastName(event.currentTarget.value)}
            />
          )}
        </Field>
        <div class="pk-cluster">
          <Button type="button" loading={saving} onClick={() => void submit()}>
            Save my details
          </Button>
          <Button type="button" variant="secondary" disabled={saving} onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </div>
      </FormSection>
      {error && <Alert tone="danger">{error}</Alert>}
    </div>
  ) : (
    <FormSection layout="stack" title="Your personal details" description={description}>
      <ParticipationIdentitySummary person={person} knownOnly scope="person" />
      {save && (
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            setFirstName(person.firstName ?? "");
            setLastName(person.lastName ?? "");
            setError(null);
            form.reset();
            setEditing(true);
          }}
        >
          Edit my details
        </Button>
      )}
      {children}
    </FormSection>
  );
}
