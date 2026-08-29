import type { MembershipCategoryCatalogEntry } from "../../../../../shared/schemas/membership-categories";

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
    <div>
      <div class="row g-2 mb-2">
        <div class="col-sm-6">
          <label class="form-label small mb-1">Applicant name</label>
          <input
            class="form-control form-control-sm"
            value={form.applicantName}
            onInput={(e) => onChange((f) => ({ ...f, applicantName: (e.target as HTMLInputElement).value }))}
            disabled={disabled}
          />
        </div>
        <div class="col-sm-6">
          <label class="form-label small mb-1">Email</label>
          <input
            type="email"
            class="form-control form-control-sm"
            value={form.applicantEmail}
            onInput={(e) => onChange((f) => ({ ...f, applicantEmail: (e.target as HTMLInputElement).value }))}
            disabled={disabled}
          />
        </div>
        <div class="col-sm-6">
          <label class="form-label small mb-1">Category</label>
          <select
            class="form-select form-select-sm"
            value={form.membershipCategory}
            onChange={(e) => onChange((f) => ({ ...f, membershipCategory: (e.target as HTMLSelectElement).value }))}
            disabled={disabled}
          >
            {categories.map((category) => (
              <option key={category.code} value={category.code}>
                {category.label} ({category.code})
              </option>
            ))}
          </select>
        </div>
        {selectedCategory?.isIndividual !== true && (
          <div class="col-sm-6">
            <label class="form-label small mb-1">Organization</label>
            <input
              class="form-control form-control-sm"
              value={form.organizationName}
              onInput={(e) => onChange((f) => ({ ...f, organizationName: (e.target as HTMLInputElement).value }))}
              disabled={disabled}
            />
          </div>
        )}
        <div class="col-sm-6">
          <label class="form-label small mb-1">Role / Job title</label>
          <input
            class="form-control form-control-sm"
            value={form.jobTitle}
            onInput={(e) => onChange((f) => ({ ...f, jobTitle: (e.target as HTMLInputElement).value }))}
            disabled={disabled}
          />
        </div>
        <div class="col-sm-6">
          <label class="form-label small mb-1">LinkedIn</label>
          <input
            class="form-control form-control-sm"
            value={form.linkedin}
            onInput={(e) => onChange((f) => ({ ...f, linkedin: (e.target as HTMLInputElement).value }))}
            disabled={disabled}
          />
        </div>
        <div class="col-sm-6">
          <label class="form-label small mb-1">Organization website</label>
          <input
            class="form-control form-control-sm"
            value={form.organizationWebsite}
            onInput={(e) => onChange((f) => ({ ...f, organizationWebsite: (e.target as HTMLInputElement).value }))}
            disabled={disabled}
          />
        </div>
        <div class="col-12">
          <label class="form-label small mb-1">About yourself</label>
          <textarea
            class="form-control form-control-sm"
            rows={3}
            value={form.aboutYourself}
            onInput={(e) => onChange((f) => ({ ...f, aboutYourself: (e.target as HTMLTextAreaElement).value }))}
            disabled={disabled}
          />
        </div>
        <div class="col-12">
          <label class="form-label small mb-1">About organization</label>
          <textarea
            class="form-control form-control-sm"
            rows={3}
            value={form.aboutOrganization}
            onInput={(e) => onChange((f) => ({ ...f, aboutOrganization: (e.target as HTMLTextAreaElement).value }))}
            disabled={disabled}
          />
        </div>
        <div class="col-12">
          <label class="form-label small mb-1">Reason for joining</label>
          <textarea
            class="form-control form-control-sm"
            rows={3}
            value={form.reason}
            onInput={(e) => onChange((f) => ({ ...f, reason: (e.target as HTMLTextAreaElement).value }))}
            disabled={disabled}
          />
        </div>
      </div>
      <hr class="my-3" />
      {error && <div class="alert alert-danger small py-2 mb-2">{error}</div>}
      <div class="d-flex gap-2">
        <button type="button" class="btn btn-sm btn-primary" onClick={onSave} disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </button>
        <button type="button" class="btn btn-sm btn-outline-secondary" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
      </div>
    </div>
  );
}
