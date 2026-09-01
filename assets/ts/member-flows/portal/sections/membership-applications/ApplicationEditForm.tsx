import type { MembershipCategoryCatalogEntry } from "../../../../../shared/schemas/membership-categories";
import { friendlyErrorMessage } from "../../../../components/ErrorAlert";
import { Alert } from "../../../../ui/Alert";
import { Button } from "../../../../ui/Button";
import { Field } from "../../../../ui/Field";
import { Select, Textarea, TextInput } from "../../../../ui/TextControl";

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
}

export function ApplicationEditForm({
  form,
  categories,
  onChange,
  disabled,
  error,
  onSave,
  onCancel,
  saving,
}: {
  form: ApplicationEditFormValue;
  categories: MembershipCategoryCatalogEntry[];
  onChange: (updater: (f: ApplicationEditFormValue) => ApplicationEditFormValue) => void;
  disabled: boolean;
  error: string;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const selectedCategory = categories.find((category) => category.code === form.membershipCategory);

  return (
    <form
      class="pk pk-stack"
      onSubmit={(e) => {
        e.preventDefault();
        onSave();
      }}
    >
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
          <Field label="Applicant name" required>
            {(control) => (
              <TextInput
                {...control}
                value={form.applicantName}
                onInput={(e) => onChange((f) => ({ ...f, applicantName: (e.target as HTMLInputElement).value }))}
              />
            )}
          </Field>
          <Field label="Email" required>
            {(control) => (
              <TextInput
                {...control}
                type="email"
                value={form.applicantEmail}
                onInput={(e) => onChange((f) => ({ ...f, applicantEmail: (e.target as HTMLInputElement).value }))}
              />
            )}
          </Field>
          <Field label="Category" required>
            {(control) => (
              <Select
                {...control}
                value={form.membershipCategory}
                onChange={(e) => onChange((f) => ({ ...f, membershipCategory: (e.target as HTMLSelectElement).value }))}
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
            <Field label="Organization">
              {(control) => (
                <TextInput
                  {...control}
                  value={form.organizationName}
                  onInput={(e) => onChange((f) => ({ ...f, organizationName: (e.target as HTMLInputElement).value }))}
                />
              )}
            </Field>
          )}
          <Field label="Role / Job title">
            {(control) => (
              <TextInput
                {...control}
                value={form.jobTitle}
                onInput={(e) => onChange((f) => ({ ...f, jobTitle: (e.target as HTMLInputElement).value }))}
              />
            )}
          </Field>
          <Field label="LinkedIn">
            {(control) => (
              <TextInput
                {...control}
                value={form.linkedin}
                onInput={(e) => onChange((f) => ({ ...f, linkedin: (e.target as HTMLInputElement).value }))}
              />
            )}
          </Field>
          <Field label="Organization website">
            {(control) => (
              <TextInput
                {...control}
                value={form.organizationWebsite}
                onInput={(e) => onChange((f) => ({ ...f, organizationWebsite: (e.target as HTMLInputElement).value }))}
              />
            )}
          </Field>
        </div>

        <Field label="About yourself">
          {(control) => (
            <Textarea
              {...control}
              rows={3}
              value={form.aboutYourself}
              onInput={(e) => onChange((f) => ({ ...f, aboutYourself: (e.target as HTMLTextAreaElement).value }))}
            />
          )}
        </Field>
        <Field label="About organization">
          {(control) => (
            <Textarea
              {...control}
              rows={3}
              value={form.aboutOrganization}
              onInput={(e) => onChange((f) => ({ ...f, aboutOrganization: (e.target as HTMLTextAreaElement).value }))}
            />
          )}
        </Field>
        <Field label="Reason for joining">
          {(control) => (
            <Textarea
              {...control}
              rows={3}
              value={form.reason}
              onInput={(e) => onChange((f) => ({ ...f, reason: (e.target as HTMLTextAreaElement).value }))}
            />
          )}
        </Field>
      </fieldset>

      {error && <Alert tone="danger">{friendlyErrorMessage(error)}</Alert>}

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
