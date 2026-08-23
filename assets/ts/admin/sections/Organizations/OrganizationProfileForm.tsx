/**
 * Organization profile edit form (name/slogan/URLs/description/content/
 * links/category/member-since). Split out of Organizations.tsx (PR #1
 * review).
 */
import { useState } from "preact/hooks";
import { api } from "../../api";
import { adminOrganizationDetailResponseSchema } from "../../../../shared/schemas/admin-organizations";
import type { AdminOrganizationDetail } from "../../types";
import { ORG_TIED_MEMBERSHIP_CATEGORIES } from "../../../../shared/schemas/admin-organizations";
import { linksToText, textToLinks } from "../../../shared/links-text";
import { performAdminAction } from "../../actions";
import { FormActions } from "../../components/FormActions";

const PROFILE_TEXT_FIELDS: Array<[label: string, field: keyof AdminOrganizationDetail]> = [
  ["Name", "name"],
  ["Slogan", "slogan"],
  ["Website", "website"],
  ["Blog URL", "blogUrl"],
  ["Blog feed URL", "blogFeedUrl"],
  ["Press URL", "pressUrl"],
  ["Press feed URL", "pressFeedUrl"],
  ["Careers URL", "careersUrl"],
];

export function OrganizationProfileForm({
  org,
  onSaved,
  onCancel,
}: {
  org: AdminOrganizationDetail;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const [, field] of PROFILE_TEXT_FIELDS) initial[field] = (org[field] as string | null) ?? "";
    initial.description = org.description ?? "";
    initial.contentMarkdown = org.contentMarkdown ?? "";
    return initial;
  });
  const [linksText, setLinksText] = useState(() => linksToText(org.links));
  const [membershipCategory, setMembershipCategory] = useState<string>(
    org.membershipCategory ?? ORG_TIED_MEMBERSHIP_CATEGORIES[0],
  );
  const [memberSince, setMemberSince] = useState(org.memberSince.slice(0, 10));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: Event) {
    e.preventDefault();
    setError("");
    const body: Record<string, string | string[] | null> = { membershipCategory, memberSince: memberSince || null };
    for (const [, field] of PROFILE_TEXT_FIELDS) {
      body[field] = form[field].trim() ? form[field].trim() : null;
    }
    body.description = form.description.trim() ? form.description.trim() : null;
    body.contentMarkdown = form.contentMarkdown.trim() ? form.contentMarkdown.trim() : null;
    body.links = textToLinks(linksText);
    await performAdminAction({
      setBusy: setSaving,
      request: () =>
        api(`/api/v1/admin/organizations/${org.id}`, adminOrganizationDetailResponseSchema, {
          method: "PATCH",
          body: JSON.stringify(body),
        }),
      successMessage: "Organization updated",
      afterSuccess: onSaved,
      onError: setError,
    });
  }

  return (
    <form onSubmit={handleSubmit}>
      <div class="row g-2 mb-2">
        <div class="col-md-4">
          <label class="form-label small mb-1">Membership category</label>
          <select
            class="form-select form-select-sm"
            value={membershipCategory}
            onChange={(e) => setMembershipCategory((e.target as HTMLSelectElement).value)}
            disabled={saving}
          >
            {ORG_TIED_MEMBERSHIP_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <div class="form-text">Changing this updates every representative's category to match.</div>
        </div>
        <div class="col-md-4">
          <label class="form-label small mb-1">Member since</label>
          <input
            type="date"
            class="form-control form-control-sm"
            value={memberSince}
            onInput={(e) => setMemberSince((e.target as HTMLInputElement).value)}
            disabled={saving}
          />
        </div>
        {PROFILE_TEXT_FIELDS.map(([label, field]) => (
          <div key={field} class="col-md-4">
            <label class="form-label small mb-1">{label}</label>
            <input
              type="text"
              class="form-control form-control-sm"
              value={form[field]}
              onInput={(e) => setForm((f) => ({ ...f, [field]: (e.target as HTMLInputElement).value }))}
              disabled={saving}
            />
          </div>
        ))}
        <div class="col-12">
          <label class="form-label small mb-1">Description</label>
          <textarea
            class="form-control form-control-sm"
            rows={2}
            value={form.description}
            onInput={(e) => setForm((f) => ({ ...f, description: (e.target as HTMLTextAreaElement).value }))}
            disabled={saving}
          />
        </div>
        <div class="col-12">
          <label class="form-label small mb-1">Content (Markdown)</label>
          <textarea
            class="form-control form-control-sm mono"
            rows={8}
            value={form.contentMarkdown}
            onInput={(e) => setForm((f) => ({ ...f, contentMarkdown: (e.target as HTMLTextAreaElement).value }))}
            disabled={saving}
          />
        </div>
        <div class="col-12">
          <label class="form-label small mb-1">Links (X, LinkedIn, Facebook, etc — one URL per line)</label>
          <textarea
            class="form-control form-control-sm"
            rows={4}
            value={linksText}
            onInput={(e) => setLinksText((e.target as HTMLTextAreaElement).value)}
            disabled={saving}
          />
        </div>
      </div>
      <FormActions
        submitLabel="Save"
        busyLabel="Saving…"
        busy={saving}
        onCancel={onCancel}
        status={error}
        statusVariant="danger"
        submitVariant="primary"
      />
    </form>
  );
}
