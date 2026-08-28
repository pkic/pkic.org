import { useState } from "preact/hooks";
import {
  orgTiedMembershipCategorySchema,
  organizationDetailResponseSchema,
  type OrganizationDetail,
} from "../../../../../shared/schemas/organization-management";
import { FormActions } from "../../../../components/FormActions";
import { ProfileLinksInput } from "../../../../components/ProfileLinksInput";
import { patchJson } from "../../../../shared/api-client";
import { fmt, toast } from "../../ui";

const ORG_TIED_MEMBERSHIP_CATEGORIES = orgTiedMembershipCategorySchema.options;

const PROFILE_FIELDS = [
  ["Name", "name"],
  ["Slogan", "slogan"],
  ["Website", "website"],
  ["Blog URL", "blogUrl"],
  ["Blog feed URL", "blogFeedUrl"],
  ["Press URL", "pressUrl"],
  ["Press feed URL", "pressFeedUrl"],
  ["Careers URL", "careersUrl"],
] as const;

type ProfileField = (typeof PROFILE_FIELDS)[number][1];

function OrganizationProfileForm({
  organization,
  onSaved,
  onCancel,
}: {
  organization: OrganizationDetail;
  onSaved: () => Promise<void>;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<Record<ProfileField, string>>(
    () =>
      Object.fromEntries(PROFILE_FIELDS.map(([, field]) => [field, organization[field] ?? ""])) as Record<
        ProfileField,
        string
      >,
  );
  const [description, setDescription] = useState(organization.description ?? "");
  const [contentMarkdown, setContentMarkdown] = useState(organization.contentMarkdown ?? "");
  const [links, setLinks] = useState(organization.links);
  const [membershipCategory, setMembershipCategory] = useState(
    organization.membershipCategory ?? ORG_TIED_MEMBERSHIP_CATEGORIES[0],
  );
  const [memberSince, setMemberSince] = useState(organization.memberSince.slice(0, 10));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: Event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await patchJson(
        `/api/v1/organizations/${encodeURIComponent(organization.id)}`,
        {
          membershipCategory,
          memberSince: memberSince || null,
          ...Object.fromEntries(PROFILE_FIELDS.map(([, field]) => [field, form[field].trim() || null])),
          description: description.trim() || null,
          contentMarkdown: contentMarkdown.trim() || null,
          links,
          revision: organization.updatedAt,
        },
        organizationDetailResponseSchema,
      );
      toast("Organization updated", "success");
      await onSaved();
    } catch (caught) {
      const message = (caught as Error).message;
      setError(message);
      toast(message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <div class="row g-2 mb-2">
        <div class="col-md-4">
          <label class="form-label small mb-1" for="organization-profile-category">
            Membership category
          </label>
          <select
            id="organization-profile-category"
            class="form-select form-select-sm"
            value={membershipCategory}
            onChange={(event) => setMembershipCategory((event.target as HTMLSelectElement).value)}
            disabled={busy}
          >
            {ORG_TIED_MEMBERSHIP_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
          <div class="form-text">This category applies to all representatives.</div>
        </div>
        <div class="col-md-4">
          <label class="form-label small mb-1" for="organization-profile-member-since">
            Member since
          </label>
          <input
            id="organization-profile-member-since"
            type="date"
            class="form-control form-control-sm"
            value={memberSince}
            onInput={(event) => setMemberSince((event.target as HTMLInputElement).value)}
            disabled={busy}
          />
        </div>
        {PROFILE_FIELDS.map(([label, field]) => (
          <div key={field} class="col-md-4">
            <label class="form-label small mb-1" for={`organization-profile-${field}`}>
              {label}
            </label>
            <input
              id={`organization-profile-${field}`}
              type={field === "website" || field.endsWith("Url") ? "url" : "text"}
              class="form-control form-control-sm"
              value={form[field]}
              onInput={(event) =>
                setForm((current) => ({ ...current, [field]: (event.target as HTMLInputElement).value }))
              }
              disabled={busy}
            />
          </div>
        ))}
        <div class="col-12">
          <label class="form-label small mb-1" for="organization-profile-description">
            Description
          </label>
          <textarea
            id="organization-profile-description"
            class="form-control form-control-sm"
            rows={2}
            value={description}
            onInput={(event) => setDescription((event.target as HTMLTextAreaElement).value)}
            disabled={busy}
          />
        </div>
        <div class="col-12">
          <label class="form-label small mb-1" for="organization-profile-content">
            Content (Markdown)
          </label>
          <textarea
            id="organization-profile-content"
            class="form-control form-control-sm mono"
            rows={8}
            value={contentMarkdown}
            onInput={(event) => setContentMarkdown((event.target as HTMLTextAreaElement).value)}
            disabled={busy}
          />
        </div>
        <div class="col-12">
          <label class="form-label small mb-1">Links</label>
          <ProfileLinksInput fieldName="organization.links" value={links} onChange={setLinks} />
        </div>
      </div>
      <FormActions
        submitLabel="Save"
        busyLabel="Saving…"
        busy={busy}
        onCancel={onCancel}
        status={error}
        statusVariant="danger"
        submitVariant="primary"
      />
    </form>
  );
}

function Contacts({ organization, onSaved }: { organization: OrganizationDetail; onSaved: () => Promise<void> }) {
  const [busy, setBusy] = useState<"primaryContactUserId" | "secondaryContactUserId" | null>(null);

  async function update(field: "primaryContactUserId" | "secondaryContactUserId", userId: string) {
    setBusy(field);
    try {
      await patchJson(
        `/api/v1/organizations/${encodeURIComponent(organization.id)}`,
        { [field]: userId || null, revision: organization.updatedAt },
        organizationDetailResponseSchema,
      );
      toast("Contact updated", "success");
      await onSaved();
    } catch (caught) {
      toast((caught as Error).message, "error");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section class="card border-0 shadow-sm mb-4" aria-labelledby="organization-contacts-heading">
      <div class="card-header bg-white fw-semibold" id="organization-contacts-heading">
        Contacts
      </div>
      <div class="card-body p-3">
        <div class="row g-2">
          {(
            [
              ["Primary contact", "primaryContactUserId"],
              ["Secondary contact", "secondaryContactUserId"],
            ] as const
          ).map(([label, field]) => (
            <div class="col-md-6" key={field}>
              <label class="form-label small" for={`organization-contact-${field}`}>
                {label}
              </label>
              <select
                id={`organization-contact-${field}`}
                class="form-select form-select-sm"
                value={organization[field] ?? ""}
                disabled={busy !== null}
                onChange={(event) => void update(field, (event.target as HTMLSelectElement).value)}
              >
                <option value="">None</option>
                {organization.representatives.map((representative) => (
                  <option key={representative.userId} value={representative.userId}>
                    {representative.name} ({representative.email})
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function OrganizationProfile({
  organization,
  canWrite,
  onSaved,
}: {
  organization: OrganizationDetail;
  canWrite: boolean;
  onSaved: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);

  return (
    <>
      <section class="card border-0 shadow-sm mb-4" aria-labelledby="organization-profile-heading">
        <div class="card-header bg-white fw-semibold d-flex align-items-center justify-content-between">
          <span id="organization-profile-heading">Profile</span>
          {canWrite && !editing && (
            <button type="button" class="btn btn-sm btn-outline-primary" onClick={() => setEditing(true)}>
              Edit
            </button>
          )}
        </div>
        <div class="card-body p-3">
          {editing ? (
            <OrganizationProfileForm
              organization={organization}
              onSaved={async () => {
                setEditing(false);
                await onSaved();
              }}
              onCancel={() => setEditing(false)}
            />
          ) : (
            <table class="table table-sm table-borderless mb-0">
              <tbody>
                <tr>
                  <th class="text-muted small">Membership category</th>
                  <td>
                    {organization.membershipCategory ? (
                      <span class="badge text-bg-success mono">{organization.membershipCategory}</span>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
                {[
                  ["Website", organization.website],
                  ["Slogan", organization.slogan],
                  ["Description", organization.description],
                  ["Blog", organization.blogUrl],
                  ["Press", organization.pressUrl],
                  ["Careers", organization.careersUrl],
                  ["Member since", fmt(organization.memberSince)],
                  ["Created", fmt(organization.createdAt)],
                ].map(([label, value]) => (
                  <tr key={label}>
                    <th class="text-muted small">{label}</th>
                    <td>{value || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
      {canWrite && <Contacts organization={organization} onSaved={onSaved} />}
    </>
  );
}
