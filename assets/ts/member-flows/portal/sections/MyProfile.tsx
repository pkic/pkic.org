/**
 * My Profile — edit. Editable fields: first
 * name, last name, preferred name, job title, biography, social links.
 * Organization name is only editable for org-less (H5/H6/H7) members
 * (profile.canEditOrganizationName). Headshot upload and the org-page
 * visibility toggle live in the same tab nav table.
 */
import { useState } from "preact/hooks";
import { getJson, patchJson, postJson, putJson, ApiClientError } from "../../../shared/api-client";
import { AdminHeadshotManager } from "../../../shared/headshot/AdminHeadshotManager";
import { uploadFile } from "../../../shared/file-upload";
import { Spinner } from "../../../components/Spinner";
import { ErrorAlert } from "../../../components/ErrorAlert";
import { profile as profileSignal, saveProfile } from "../state";
import { toast } from "../ui";
import type { MyProfile as MyProfileType, MyProfileUpdateInput } from "../types";
import { linksToText, textToLinks } from "../../../shared/links-text";

async function refreshProfile(): Promise<void> {
  const refreshed = await getJson<MyProfileType>("/api/v1/me");
  saveProfile(refreshed);
}

export function MyProfile() {
  const current = profileSignal.value;
  const [form, setForm] = useState(() => ({
    firstName: current?.firstName ?? "",
    lastName: current?.lastName ?? "",
    preferredName: current?.preferredName ?? "",
    jobTitle: current?.jobTitle ?? "",
    biography: current?.biography ?? "",
    linksText: linksToText(current?.links ?? []),
    organizationName: current?.organizationName ?? "",
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [visibilitySaving, setVisibilitySaving] = useState(false);

  if (!current) return <Spinner />;

  async function handleSubmit(e: Event): Promise<void> {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const input: MyProfileUpdateInput = {
        firstName: form.firstName.trim() || undefined,
        lastName: form.lastName.trim() || undefined,
        preferredName: form.preferredName.trim(),
        jobTitle: form.jobTitle.trim(),
        biography: form.biography.trim(),
        links: textToLinks(form.linksText),
      };
      if (current!.canEditOrganizationName) {
        input.organizationName = form.organizationName.trim();
      }
      const updated = await patchJson<MyProfileType>("/api/v1/me", input);
      saveProfile(updated);
      toast("Profile updated", "success");
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not update your profile. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function handleVisibilityToggle(next: boolean): Promise<void> {
    setVisibilitySaving(true);
    try {
      await patchJson("/api/v1/me/organization-visibility", { showOnOrgProfile: next });
      await refreshProfile();
      toast(
        next
          ? "You'll now appear on your organization's public page"
          : "You're now hidden from your organization's public page",
        "success",
      );
    } catch (err) {
      toast(err instanceof ApiClientError ? err.message : "Could not update visibility.", "error");
    } finally {
      setVisibilitySaving(false);
    }
  }

  return (
    <div class="row g-4 content-width-lg">
      <div class="col-md-4">
        <div class="card border-0 shadow-sm">
          <div class="card-body">
            <AdminHeadshotManager
              initialUrl={current.headshotUrl}
              alt={current.email}
              emptyLabel="You"
              uploadLabel="📷 Upload headshot"
              helpText="JPEG, PNG, or WebP, up to 5MB."
              uploadHeadshot={async (file) => {
                await uploadFile("/api/v1/me/headshot", file);
                await refreshProfile();
                return { headshotUrl: profileSignal.value?.headshotUrl };
              }}
            />
          </div>
        </div>

        {current.organizationId && (
          <div class="card border-0 shadow-sm mt-3">
            <div class="card-body">
              <div class="form-check form-switch">
                <input
                  class="form-check-input"
                  type="checkbox"
                  role="switch"
                  id="portal-org-visibility"
                  checked={current.showOnOrgProfile}
                  disabled={visibilitySaving}
                  onChange={(e) => void handleVisibilityToggle((e.target as HTMLInputElement).checked)}
                />
                <label class="form-check-label small" for="portal-org-visibility">
                  Show my name, job title, and bio on {current.organizationName ?? "my organization"}'s public page
                </label>
              </div>
            </div>
          </div>
        )}

        {current.activeMemberships.length > 1 && <ActiveMembershipSwitcher current={current} />}
      </div>

      <div class="col-md-8">
        <div class="card border-0 shadow-sm">
          <div class="card-body">
            <form
              onSubmit={(e) => {
                void handleSubmit(e);
              }}
            >
              <div class="row g-3">
                <div class="col-sm-6">
                  <label class="form-label fw-semibold small">First name</label>
                  <input
                    class="form-control"
                    value={form.firstName}
                    onInput={(e) => setForm((f) => ({ ...f, firstName: (e.target as HTMLInputElement).value }))}
                    required
                  />
                </div>
                <div class="col-sm-6">
                  <label class="form-label fw-semibold small">Last name</label>
                  <input
                    class="form-control"
                    value={form.lastName}
                    onInput={(e) => setForm((f) => ({ ...f, lastName: (e.target as HTMLInputElement).value }))}
                    required
                  />
                </div>
                <div class="col-sm-6">
                  <label class="form-label fw-semibold small">Preferred name</label>
                  <input
                    class="form-control"
                    value={form.preferredName}
                    onInput={(e) => setForm((f) => ({ ...f, preferredName: (e.target as HTMLInputElement).value }))}
                    placeholder="Shown instead of first/last name if set"
                  />
                </div>
                <div class="col-sm-6">
                  <label class="form-label fw-semibold small">Job title</label>
                  <input
                    class="form-control"
                    value={form.jobTitle}
                    onInput={(e) => setForm((f) => ({ ...f, jobTitle: (e.target as HTMLInputElement).value }))}
                  />
                </div>
                {current.canEditOrganizationName && (
                  <div class="col-12">
                    <label class="form-label fw-semibold small">Organization</label>
                    <input
                      class="form-control"
                      value={form.organizationName}
                      onInput={(e) =>
                        setForm((f) => ({ ...f, organizationName: (e.target as HTMLInputElement).value }))
                      }
                    />
                  </div>
                )}
                <div class="col-12">
                  <label class="form-label fw-semibold small">Biography</label>
                  <textarea
                    class="form-control"
                    rows={5}
                    value={form.biography}
                    onInput={(e) => setForm((f) => ({ ...f, biography: (e.target as HTMLTextAreaElement).value }))}
                  />
                </div>
                <div class="col-12">
                  <label class="form-label fw-semibold small">Social / profile links</label>
                  <textarea
                    class="form-control"
                    rows={3}
                    placeholder="One URL per line"
                    value={form.linksText}
                    onInput={(e) => setForm((f) => ({ ...f, linksText: (e.target as HTMLTextAreaElement).value }))}
                  />
                </div>
              </div>

              {error && <ErrorAlert error={error} />}

              <button type="submit" class="btn btn-success mt-3" disabled={saving}>
                {saving ? "Saving…" : "Save changes"}
              </button>
            </form>
          </div>
        </div>

        <div class="card border-0 shadow-sm mt-3">
          <div class="card-body">
            <dl class="row mb-0 small">
              <dt class="col-sm-4">Email</dt>
              <dd class="col-sm-8">{current.email}</dd>
              <dt class="col-sm-4">Membership category</dt>
              <dd class="col-sm-8">{current.membershipCategory}</dd>
              <dt class="col-sm-4">Member since</dt>
              <dd class="col-sm-8">{new Date(current.memberSince).toLocaleDateString()}</dd>
            </dl>
          </div>
        </div>

        {current.organizationRepresentatives && current.organizationRepresentatives.length > 0 && (
          <div class="card border-0 shadow-sm mt-3">
            <div class="card-body">
              <h3 class="h6 mb-3">Organization representatives</h3>
              <ul class="list-group list-group-flush">
                {current.organizationRepresentatives.map((rep) => (
                  <li key={rep.userId} class="list-group-item d-flex justify-content-between align-items-center px-0">
                    <span>
                      {rep.name ?? rep.email} <span class="text-muted small">({rep.email})</span>
                    </span>
                    {rep.isPrimaryContact && <span class="badge text-bg-success">Primary contact</span>}
                    {rep.isSecondaryContact && <span class="badge text-bg-secondary">Secondary contact</span>}
                  </li>
                ))}
              </ul>
              {current.isOrgContact && <AddCoworkerForm />}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Only rendered when the caller represents more than one organization (or
 * an organization plus their own individual membership) concurrently —
 * lets them pick which membership context the rest of the portal (working
 * groups, votes, applications, etc.) acts as. Switching reissues the
 * session cookie server-side (PUT /api/v1/me/active-membership) and then
 * does a full navigation rather than a signal update, so every other
 * org-scoped screen re-fetches under the new context instead of holding
 * stale state from the previous one.
 */
function ActiveMembershipSwitcher({ current }: { current: MyProfileType }) {
  const [switching, setSwitching] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The currently-active entry is whichever membership matches the
  // organization (or org-less-ness) the rest of this profile response is
  // already scoped to.
  const activeMemberId =
    current.activeMemberships.find((m) => m.organizationId === current.organizationId)?.memberId ?? null;

  async function handleSwitch(memberId: string): Promise<void> {
    if (memberId === activeMemberId) return;
    setError(null);
    setSwitching(memberId);
    try {
      await putJson<MyProfileType>("/api/v1/me/active-membership", { memberId });
      // A full reload, not window.location.assign to this same route — the
      // caller is already on #/profile, so assigning that same URL is a
      // no-op and would leave every other org-scoped screen (working
      // groups, votes, applications) holding state from the org context
      // just switched away from.
      window.location.reload();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not switch membership. Please try again.");
      setSwitching(null);
    }
  }

  return (
    <div class="card border-0 shadow-sm mt-3">
      <div class="card-body">
        <h3 class="h6 mb-2">Acting as</h3>
        <p class="text-muted small mb-2">
          You represent more than one membership. Switch which one the portal acts as below.
        </p>
        <ul class="list-group list-group-flush">
          {current.activeMemberships.map((m) => {
            const isActive = m.memberId === activeMemberId;
            return (
              <li key={m.memberId} class="list-group-item d-flex justify-content-between align-items-center px-0">
                <span>
                  {m.organizationName ?? "My own membership"}{" "}
                  <span class="text-muted small">({m.membershipCategory})</span>
                </span>
                {isActive ? (
                  <span class="badge text-bg-success">Current</span>
                ) : (
                  <button
                    type="button"
                    class="btn btn-sm btn-outline-success"
                    disabled={switching !== null}
                    onClick={() => void handleSwitch(m.memberId)}
                  >
                    {switching === m.memberId ? "Switching…" : "Switch"}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
        {error && <div class="alert alert-danger mt-2 small">✕ {error}</div>}
      </div>
    </div>
  );
}

function AddCoworkerForm() {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleSubmit(e: Event): Promise<void> {
    e.preventDefault();
    const form = e.currentTarget as HTMLFormElement;
    const name = (form.elements.namedItem("name") as HTMLInputElement).value.trim();
    const email = (form.elements.namedItem("email") as HTMLInputElement).value.trim();
    if (!name || !email) return;
    setError(null);
    setSuccess(null);
    setSubmitting(true);
    try {
      const created = await postJson<{ name: string; email: string }>("/api/v1/me/organization/members", {
        name,
        email,
      });
      setSuccess(`${created.name} (${created.email}) was added to your organization.`);
      form.reset();
      await refreshProfile();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not add this coworker. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div class="mt-4">
      <h4 class="h6 mb-2">Add a coworker</h4>
      <form
        onSubmit={(e) => {
          void handleSubmit(e);
        }}
        class="d-flex gap-2 flex-wrap align-items-end"
      >
        <div>
          <label class="form-label small mb-1">Name</label>
          <input class="form-control form-control-sm" type="text" name="name" required />
        </div>
        <div>
          <label class="form-label small mb-1">Email</label>
          <input class="form-control form-control-sm" type="email" name="email" required />
        </div>
        <button type="submit" class="btn btn-sm btn-success" disabled={submitting}>
          {submitting ? "Adding…" : "Add coworker"}
        </button>
      </form>
      {success && <div class="alert alert-success mt-2 small">✓ {success}</div>}
      {error && <div class="alert alert-danger mt-2 small">✕ {error}</div>}
    </div>
  );
}
