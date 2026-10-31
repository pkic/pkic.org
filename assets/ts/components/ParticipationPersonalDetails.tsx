import { personNamePatchSchema } from "../../shared/schemas/api-common";
import type { ComponentChildren } from "preact";
import { createPortal } from "preact/compat";
import { useEffect, useState } from "preact/hooks";
import type { z } from "zod";
import { useContractForm } from "../hooks/useContractForm";
import { useDialogQueryState } from "../hooks/useDialogQueryState";
import { Alert } from "../ui/Alert";
import { Button } from "../ui/Button";
import { DescriptionList } from "../ui/DescriptionList";
import { Dialog } from "../ui/Dialog";
import { Field } from "../ui/Field";
import { FormSection } from "../ui/FormSection";
import { TextInput } from "../ui/TextControl";
import type { ParticipationPerson } from "./useProposalEntryIdentity";

export type PersonalNamePatch = z.infer<typeof personNamePatchSchema>;

/** One canonical personal-name editor; each embedding supplies its existing authority adapter. */
export function ParticipationPersonalDetails({
  person,
  save,
  description,
  children,
  summary,
  refusal,
}: {
  person: Pick<ParticipationPerson, "firstName" | "lastName">;
  description?: string;
  children?: ComponentChildren;
  save?: (names: PersonalNamePatch) => Promise<void>;
  summary?: (edit: (() => void) | undefined) => ComponentChildren;
  refusal?: string;
}) {
  const [editing, showEditing, closeEditing] = useDialogQueryState("personal-details");
  const [firstName, setFirstName] = useState(person.firstName ?? "");
  const [lastName, setLastName] = useState(person.lastName ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const form = useContractForm(personNamePatchSchema, { firstName, lastName });
  function edit() {
    setFirstName(person.firstName ?? "");
    setLastName(person.lastName ?? "");
    setError(null);
    form.reset();
    showEditing();
  }
  useEffect(() => {
    if (refusal && save) {
      edit();
      form.submit();
      setError(refusal);
    }
  }, [refusal]);
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
      await closeEditing();
    } catch (failure) {
      setError(form.refuse(failure));
    } finally {
      setSaving(false);
    }
  }
  return (
    <>
      {summary ? (
        summary(save ? edit : undefined)
      ) : (
        <FormSection layout="stack" title="Your personal details" description={description}>
          {(person.firstName || person.lastName) && (
            <DescriptionList
              items={[{ term: "Name", value: [person.firstName, person.lastName].filter(Boolean).join(" ") }]}
            />
          )}
          {save && (
            <Button type="button" variant="secondary" onClick={edit}>
              Edit my details
            </Button>
          )}
          {children}
        </FormSection>
      )}
      {save &&
        createPortal(
          <Dialog
            open={editing}
            title="Edit my details"
            description="These changes update your stored personal details. Your representations stay unchanged."
            confirmLabel="Save my details"
            onConfirm={() => void submit()}
            onCancel={() => {
              if (!saving) void closeEditing();
            }}
            confirmDisabled={saving}
          >
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
              <Field label="First name" required {...form.of("firstName")}>
                {(control) => (
                  <TextInput
                    {...control}
                    name="firstName"
                    autoComplete="given-name"
                    value={firstName}
                    onInput={(event) => setFirstName(event.currentTarget.value)}
                  />
                )}
              </Field>
              <Field label="Last name" required {...form.of("lastName")}>
                {(control) => (
                  <TextInput
                    {...control}
                    name="lastName"
                    autoComplete="family-name"
                    value={lastName}
                    onInput={(event) => setLastName(event.currentTarget.value)}
                  />
                )}
              </Field>
              {error && <Alert tone="danger">{error}</Alert>}
            </div>
          </Dialog>,
          document.body,
        )}
    </>
  );
}
