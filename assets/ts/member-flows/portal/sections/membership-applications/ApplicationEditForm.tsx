import type { MembershipApplicationDetail } from "../../../../../shared/schemas/membership-application-management";
import { useState } from "preact/hooks";
import type { z } from "zod";
import {
  applicationUpdateSchema,
  applicationEditableAnswersSchema,
} from "../../../../../shared/schemas/membership-application-management";
import { useContractForm } from "../../../../hooks/useContractForm";
import { ApplicationAnswerFields } from "./ApplicationAnswerFields";
import type { MembershipCategoryCatalogEntry } from "../../../../../shared/schemas/membership-categories";
import { friendlyErrorMessage } from "../../../../components/ErrorAlert";
import { Alert } from "../../../../ui/Alert";
import { Button } from "../../../../ui/Button";
import { Field } from "../../../../ui/Field";
import { Select, TextInput } from "../../../../ui/TextControl";
import { MarkdownEditor } from "../../../../components/markdown-editor/MarkdownInput";

/** Application-answer keys editable via PATCH /api/v1/members/applications/:id (Fix 3). */
export interface ApplicationEditFormValue {
  applicantName: string;
  applicantEmail: string;
  organizationName: string;
  membershipCategory: string;
  jobTitle: string;
  linkedin: string;
  organizationWebsite: string;
  aboutYourself: string;
  aboutOrganization: string;
  reason: string;
  extraAnswers?: z.infer<typeof applicationEditableAnswersSchema>;
}

export function applicationEditPayload(form: ApplicationEditFormValue, individual: boolean) {
  return {
    applicantName: form.applicantName,
    applicantEmail: form.applicantEmail,
    organizationName: individual ? null : form.organizationName || null,
    membershipCategory: form.membershipCategory,
    answers: {
      ...form.extraAnswers,
      job_title: form.jobTitle || null,
      linkedin: form.linkedin || null,
      organization_website: form.organizationWebsite || null,
      about_yourself: form.aboutYourself || null,
      about_organization: form.aboutOrganization || null,
      reason: form.reason || null,
    },
  };
}

export function ApplicationEditForm({
  form,
  answerFields,
  requestedWorkingGroups,
  categories,
  onChange,
  disabled,
  error,
  onSave,
  onCancel,
  saving,
}: {
  form: ApplicationEditFormValue;
  answerFields?: MembershipApplicationDetail["answerFields"];
  requestedWorkingGroups?: MembershipApplicationDetail["requestedWorkingGroups"];
  categories: readonly MembershipCategoryCatalogEntry[];
  onChange: (updater: (f: ApplicationEditFormValue) => ApplicationEditFormValue) => void;
  disabled: boolean;
  error: string;
  onSave: (body: z.infer<typeof applicationUpdateSchema>) => Promise<void> | void;
  onCancel: () => void;
  saving: boolean;
}) {
  const selectedCategory = categories.find((category) => category.code === form.membershipCategory);

  const contract = useContractForm(
    applicationUpdateSchema,
    applicationEditPayload(form, selectedCategory?.isIndividual === true),
  );
  const [validationError, setValidationError] = useState("");
  async function submit(event: Event) {
    event.preventDefault();
    const checked = contract.submit();
    if (!checked.data) return setValidationError(checked.message);
    try {
      await onSave(checked.data);
      setValidationError("");
    } catch (cause) {
      setValidationError(contract.refuse(cause));
    }
  }
  return (
    <form class="pk pk-stack" noValidate {...contract.handlers} onSubmit={(event) => void submit(event)}>
      {/*
       * One `disabled` for the whole set of controls. A fieldset is the only
       * attribute that takes a group out of play in one place, and it keeps
       * the flag off nine separate controls that would each have to remember
       * it. `pk-fieldset` is the reset that removes the user agent's groove
       * border and its `min-inline-size`, which would otherwise stop the grid
       * inside it from shrinking.
       */}
      <fieldset class="pk-fieldset pk-stack" disabled={disabled}>
        <div class="pk-grid">
          <Field {...contract.of("applicantName")} label="Applicant name" required>
            {(control) => (
              <TextInput
                {...control}
                name="applicantName"
                value={form.applicantName}
                onInput={(e) => {
                  const value = e.currentTarget.value;
                  onChange((f) => ({ ...f, applicantName: value }));
                }}
              />
            )}
          </Field>
          <Field {...contract.of("applicantEmail")} label="Email" required>
            {(control) => (
              <TextInput
                {...control}
                type="email"
                name="applicantEmail"
                value={form.applicantEmail}
                onInput={(e) => {
                  const value = e.currentTarget.value;
                  onChange((f) => ({ ...f, applicantEmail: value }));
                }}
              />
            )}
          </Field>
          <Field {...contract.of("membershipCategory")} label="Category" required>
            {(control) => (
              <Select
                {...control}
                name="membershipCategory"
                value={form.membershipCategory}
                onChange={(e) => {
                  const value = e.currentTarget.value;
                  onChange((f) => ({ ...f, membershipCategory: value }));
                }}
              >
                {categories.map((category) => (
                  <option key={category.code} value={category.code}>
                    {category.label} ({category.code})
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {selectedCategory?.isIndividual !== true && (
            <Field {...contract.of("organizationName")} label="Organization">
              {(control) => (
                <TextInput
                  {...control}
                  name="organizationName"
                  value={form.organizationName}
                  onInput={(e) => {
                    const value = e.currentTarget.value;
                    onChange((f) => ({ ...f, organizationName: value }));
                  }}
                />
              )}
            </Field>
          )}
          <Field {...contract.of("answers.job_title")} label="Role / Job title">
            {(control) => (
              <TextInput
                {...control}
                name="answers.job_title"
                value={form.jobTitle}
                onInput={(e) => {
                  const value = e.currentTarget.value;
                  onChange((f) => ({ ...f, jobTitle: value }));
                }}
              />
            )}
          </Field>
          <Field {...contract.of("answers.linkedin")} label="Professional profile">
            {(control) => (
              <TextInput
                {...control}
                name="answers.linkedin"
                value={form.linkedin}
                onInput={(e) => {
                  const value = e.currentTarget.value;
                  onChange((f) => ({ ...f, linkedin: value }));
                }}
              />
            )}
          </Field>
          <Field {...contract.of("answers.organization_website")} label="Organization website">
            {(control) => (
              <TextInput
                {...control}
                name="answers.organization_website"
                value={form.organizationWebsite}
                onInput={(e) => {
                  const value = e.currentTarget.value;
                  onChange((f) => ({ ...f, organizationWebsite: value }));
                }}
              />
            )}
          </Field>
        </div>

        {/* Prose answers take the shared Markdown editor (#114). */}
        <Field {...contract.of("answers.about_yourself")} label="About yourself">
          {(control) => (
            <MarkdownEditor
              variant="compact"
              {...control}
              name="answers.about_yourself"
              label="About yourself"
              initialValue={form.aboutYourself}
              disabled={disabled}
              onChange={(value) => onChange((f) => ({ ...f, aboutYourself: value }))}
            />
          )}
        </Field>
        <Field {...contract.of("answers.about_organization")} label="About organization">
          {(control) => (
            <MarkdownEditor
              variant="compact"
              {...control}
              name="answers.about_organization"
              label="About organization"
              initialValue={form.aboutOrganization}
              disabled={disabled}
              onChange={(value) => onChange((f) => ({ ...f, aboutOrganization: value }))}
            />
          )}
        </Field>
        <Field {...contract.of("answers.reason")} label="Reason for joining">
          {(control) => (
            <MarkdownEditor
              variant="compact"
              {...control}
              name="answers.reason"
              label="Reason for joining"
              initialValue={form.reason}
              disabled={disabled}
              onChange={(value) => onChange((f) => ({ ...f, reason: value }))}
            />
          )}
        </Field>
        <ApplicationAnswerFields
          answers={form.extraAnswers ?? {}}
          fields={answerFields}
          requestedWorkingGroups={requestedWorkingGroups}
          of={contract.of}
          onChange={(extraAnswers) => onChange((previous) => ({ ...previous, extraAnswers }))}
        />
      </fieldset>

      {(validationError || error) && <Alert tone="danger">{friendlyErrorMessage(validationError || error)}</Alert>}

      <div class="pk-cluster">
        <Button type="submit" variant="primary" size="sm" loading={saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
        <Button size="sm" disabled={saving} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
