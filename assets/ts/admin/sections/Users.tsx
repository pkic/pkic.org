import { useState, useEffect, useCallback, useRef } from "preact/hooks";
import { useHashLocation } from "wouter/use-hash-location";
import { Spinner } from "../../components/Spinner";
import { ErrorAlert } from "../../components/ErrorAlert";
import { ApiDataTable, type ApiTableActions } from "../../components/Table";
import { api } from "../api";
import { fmt, toast } from "../ui";
import type { AdminUser, AdminOrganizationSummary } from "../types";
import { confirmHeadshotUsage } from "../../shared/headshot/controller";
import { AdminHeadshotManager, ADMIN_HEADSHOT_DISCLAIMER } from "../../shared/headshot/AdminHeadshotManager";
import { ProfileLinksInput, type ProfileLinksHandle } from "../../components/ProfileLinksInput";
import { normalizeProfileLinks } from "./profile-links";
import { MEMBERSHIP_CATEGORIES, INDIVIDUAL_MEMBERSHIP_CATEGORIES } from "../../../shared/schemas/admin-members";
import { MEMBER_STATUSES } from "../../../shared/schemas/admin-organizations";
import { adminRoleValueSchema } from "../../../shared/schemas/api";
import { UserPicker, type PickedUser } from "./access-control/UserPicker";

// ────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────

interface UserMembership {
  memberId: string;
  membershipCategory: string;
  status: string;
  showOnOrgProfile: boolean;
  organizationId: string | null;
  organizationName: string | null;
  createdAt: string;
  workingGroups: Array<{ id: string; name: string; slug: string }>;
}

interface UserDetail {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
  organization_name: string | null;
  job_title: string | null;
  biography: string | null;
  links?: Array<string | { label?: string | null; url?: string | null }>;
  role: string;
  active: boolean;
  isEcMember?: boolean;
  headshot_r2_key: string | null;
  headshot_updated_at: string | null;
  headshotUrl: string | null;
  created_at: string;
  updated_at: string;
  pii_redacted_at: string | null;
  membership: UserMembership | null;
}

const ROLE_COLOR: Record<string, string> = { admin: "danger", user: "secondary", guest: "light" };

// ────────────────────────────────────────────────────────
// Membership panel — folds the old standalone "Members" section into the
// user's own detail view. Org-tied categories are granted by attaching the
// user as a representative of an organization (search-and-pick); org-less
// individual categories (H5/H6/H7) are granted directly on this user.
// ────────────────────────────────────────────────────────

// Individual (org-less H5/H6/H7) categories are picked directly here.
// Org-tied categories are no longer picked here at all — attaching someone
// to an organization now always inherits that organization's category
// (migration 0040), so this form just needs "which organization", not
// "which category".
const GRANT_MODE_ORG_TIED = "__org_tied__";

function GrantMembershipForm({
  user,
  onGranted,
  onCancel,
}: {
  user: UserDetail;
  onGranted: () => void;
  onCancel: () => void;
}) {
  const [mode, setMode] = useState<string>(GRANT_MODE_ORG_TIED);
  const [orgQuery, setOrgQuery] = useState("");
  const [orgResults, setOrgResults] = useState<AdminOrganizationSummary[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState("");
  const [selectedOrgCategory, setSelectedOrgCategory] = useState<string | null | undefined>(undefined);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const isIndividual = mode !== GRANT_MODE_ORG_TIED;
  const displayName = [user.first_name, user.last_name].filter(Boolean).join(" ") || user.email;

  async function searchOrgs() {
    setSearching(true);
    try {
      const data = await api<{ organizations: AdminOrganizationSummary[] }>(
        `/api/v1/admin/organizations?limit=10${orgQuery.trim() ? `&q=${encodeURIComponent(orgQuery.trim())}` : ""}`,
      );
      setOrgResults(data.organizations);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setSearching(false);
    }
  }

  async function pickOrg(orgId: string) {
    setSelectedOrgId(orgId);
    setSelectedOrgCategory(undefined);
    if (!orgId) return;
    try {
      const data = await api<{ organization: { membershipCategory: string | null } }>(
        `/api/v1/admin/organizations/${orgId}`,
      );
      setSelectedOrgCategory(data.organization.membershipCategory);
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  async function handleSubmit(e: Event) {
    e.preventDefault();
    if (!isIndividual && !selectedOrgId) {
      setError("Pick an organization.");
      return;
    }
    if (!isIndividual && !selectedOrgCategory) {
      setError("This organization has no membership category set yet — set it in Organizations first.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      if (isIndividual) {
        await api(`/api/v1/admin/users/${user.id}/membership`, {
          method: "POST",
          body: JSON.stringify({ membershipCategory: mode }),
        });
      } else {
        await api(`/api/v1/admin/organizations/${selectedOrgId}/members`, {
          method: "POST",
          body: JSON.stringify({
            name: displayName,
            email: user.email,
            ...(user.job_title ? { jobTitle: user.job_title } : {}),
          }),
        });
      }
      toast("Membership granted", "success");
      onGranted();
    } catch (err) {
      const msg = (err as Error).message;
      setError(msg);
      toast(msg, "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <div class="row g-2 align-items-end">
        <div class="col-md-3">
          <label class="form-label small text-muted mb-1">Category</label>
          <select
            class="form-select form-select-sm"
            value={mode}
            onChange={(e) => setMode((e.target as HTMLSelectElement).value)}
          >
            <option value={GRANT_MODE_ORG_TIED}>Organization-tied (set by org)</option>
            {MEMBERSHIP_CATEGORIES.filter((c) => INDIVIDUAL_MEMBERSHIP_CATEGORIES.has(c)).map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        {!isIndividual && (
          <>
            <div class="col-md-4">
              <label class="form-label small text-muted mb-1">Find organization</label>
              <div class="d-flex gap-1">
                <input
                  class="form-control form-control-sm"
                  value={orgQuery}
                  onInput={(e) => setOrgQuery((e.target as HTMLInputElement).value)}
                  placeholder="Organization name"
                />
                <button
                  type="button"
                  class="btn btn-sm btn-outline-secondary"
                  disabled={searching}
                  onClick={searchOrgs}
                >
                  Search
                </button>
              </div>
            </div>
            <div class="col-md-3">
              <label class="form-label small text-muted mb-1">Organization</label>
              <select
                class="form-select form-select-sm"
                value={selectedOrgId}
                onChange={(e) => void pickOrg((e.target as HTMLSelectElement).value)}
              >
                <option value="">— Pick —</option>
                {orgResults.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
              {selectedOrgId && selectedOrgCategory !== undefined && (
                <div class="form-text">
                  {selectedOrgCategory
                    ? `Category: ${selectedOrgCategory}`
                    : "No category set on this organization yet."}
                </div>
              )}
            </div>
          </>
        )}
        <div class="col-md-2">
          <button type="submit" class="btn btn-sm btn-success" disabled={saving}>
            Grant
          </button>{" "}
          <button type="button" class="btn btn-sm btn-outline-secondary" onClick={onCancel} disabled={saving}>
            Cancel
          </button>
        </div>
      </div>
      {error && <div class="small text-danger mt-2">{error}</div>}
    </form>
  );
}

function MembershipPanel({ user, onChanged }: { user: UserDetail; onChanged: () => Promise<void> | void }) {
  const [showGrantForm, setShowGrantForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const membership = user.membership;

  async function patchMember(body: Record<string, unknown>) {
    if (!membership) return;
    setBusy(true);
    try {
      await api(`/api/v1/admin/members/${membership.memberId}`, { method: "PATCH", body: JSON.stringify(body) });
      toast("Membership updated", "success");
      await onChanged();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function removeMembership() {
    if (!membership) return;
    if (!confirm("Remove this person's membership? Their user account is not deleted.")) return;
    setBusy(true);
    try {
      await api(`/api/v1/admin/members/${membership.memberId}`, { method: "DELETE" });
      toast("Membership removed", "success");
      await onChanged();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div class="card border-0 shadow-sm mt-4">
      <div class="card-header bg-white fw-semibold">Membership</div>
      <div class="card-body p-3">
        {!membership ? (
          <>
            {!showGrantForm ? (
              <div class="d-flex align-items-center gap-2">
                <span class="text-muted fst-italic">Not a member.</span>
                <button class="btn btn-sm btn-outline-success" onClick={() => setShowGrantForm(true)}>
                  Grant membership
                </button>
              </div>
            ) : (
              <GrantMembershipForm
                user={user}
                onGranted={() => {
                  setShowGrantForm(false);
                  void onChanged();
                }}
                onCancel={() => setShowGrantForm(false)}
              />
            )}
          </>
        ) : (
          <div>
            <table class="table table-sm table-borderless mb-2">
              <tbody>
                <tr>
                  <th class="text-muted small adm-user-info-label">Organization</th>
                  <td>{membership.organizationName ?? <span class="fst-italic text-muted">Individual member</span>}</td>
                </tr>
                <tr>
                  <th class="text-muted small adm-user-info-label">Category</th>
                  <td>
                    {membership.organizationId ? (
                      // Org-tied category is set once on the organization
                      // (migration 0040) and mirrored here — edit it from
                      // the Organizations section instead.
                      <span class="badge text-bg-success mono">{membership.membershipCategory}</span>
                    ) : (
                      <select
                        class="form-select form-select-sm d-inline-block w-auto"
                        value={membership.membershipCategory}
                        disabled={busy}
                        onChange={(e) =>
                          void patchMember({ membershipCategory: (e.target as HTMLSelectElement).value })
                        }
                      >
                        {MEMBERSHIP_CATEGORIES.filter((c) => INDIVIDUAL_MEMBERSHIP_CATEGORIES.has(c)).map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                </tr>
                <tr>
                  <th class="text-muted small adm-user-info-label">Status</th>
                  <td>
                    <select
                      class="form-select form-select-sm d-inline-block w-auto"
                      value={membership.status}
                      disabled={busy}
                      onChange={(e) => void patchMember({ status: (e.target as HTMLSelectElement).value })}
                    >
                      {MEMBER_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
                {membership.organizationId && (
                  <tr>
                    <th class="text-muted small adm-user-info-label">Show on org profile</th>
                    <td>
                      <input
                        type="checkbox"
                        class="form-check-input"
                        checked={membership.showOnOrgProfile}
                        disabled={busy}
                        onChange={(e) => void patchMember({ showOnOrgProfile: (e.target as HTMLInputElement).checked })}
                      />
                    </td>
                  </tr>
                )}
                <tr>
                  <th class="text-muted small adm-user-info-label">Working groups</th>
                  <td>
                    {membership.workingGroups.length > 0
                      ? membership.workingGroups.map((wg) => wg.name).join(", ")
                      : "—"}
                  </td>
                </tr>
                <tr>
                  <th class="text-muted small adm-user-info-label">Member since</th>
                  <td>{fmt(membership.createdAt)}</td>
                </tr>
              </tbody>
            </table>
            <button class="btn btn-sm btn-outline-danger" disabled={busy} onClick={removeMembership}>
              Remove membership
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────
// Email addresses panel — secondary emails are admin/display/search only
// and do not affect login.
// ────────────────────────────────────────────────────────

interface UserEmailRecord {
  id: string;
  email: string;
  createdAt: string;
}

function EmailAddressesPanel({ userId, primaryEmail }: { userId: string; primaryEmail: string }) {
  const [emails, setEmails] = useState<UserEmailRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [newEmail, setNewEmail] = useState("");
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api<{ emails: UserEmailRecord[] }>(`/api/v1/admin/users/${userId}/emails`);
      setEmails(data.emails);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleAdd(e: Event) {
    e.preventDefault();
    const trimmed = newEmail.trim();
    if (!trimmed) return;
    setAdding(true);
    try {
      await api(`/api/v1/admin/users/${userId}/emails`, { method: "POST", body: JSON.stringify({ email: trimmed }) });
      toast("Email added", "success");
      setNewEmail("");
      await load();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setAdding(false);
    }
  }

  async function handleRemove(emailId: string, email: string) {
    if (!confirm(`Remove ${email} from this account?`)) return;
    try {
      await api(`/api/v1/admin/users/${userId}/emails/${emailId}`, { method: "DELETE" });
      toast("Email removed", "success");
      await load();
    } catch (err) {
      toast((err as Error).message, "error");
    }
  }

  return (
    <div class="card border-0 shadow-sm mt-4">
      <div class="card-header bg-white fw-semibold">Email addresses</div>
      <div class="card-body p-3">
        <div class="small text-muted mb-2">
          Secondary emails are for admin search and record-keeping only — they do not allow logging in.
        </div>
        <table class="table table-sm table-borderless mb-2">
          <tbody>
            <tr>
              <th class="text-muted small adm-user-info-label">Primary</th>
              <td>{primaryEmail}</td>
            </tr>
            {emails.map((e) => (
              <tr key={e.id}>
                <th class="text-muted small adm-user-info-label">Secondary</th>
                <td>
                  {e.email}{" "}
                  <button class="btn btn-sm btn-outline-danger ms-2" onClick={() => void handleRemove(e.id, e.email)}>
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && (
          <form onSubmit={handleAdd} class="d-flex gap-2">
            <input
              type="email"
              class="form-control form-control-sm"
              style={{ maxWidth: "280px" }}
              placeholder="another@example.com"
              value={newEmail}
              onInput={(e) => setNewEmail((e.target as HTMLInputElement).value)}
              disabled={adding}
            />
            <button type="submit" class="btn btn-sm btn-outline-success" disabled={adding || !newEmail.trim()}>
              {adding ? "Adding…" : "Add email"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────
// Merge panel — folds a duplicate account (e.g. created from a different
// Google Groups roster email during the YAML->D1 migration) into this one.
// ────────────────────────────────────────────────────────

function MergeAccountPanel({ userId, onMerged }: { userId: string; onMerged: () => Promise<void> | void }) {
  const [sourceUser, setSourceUser] = useState<PickedUser | null>(null);
  const [merging, setMerging] = useState(false);

  async function handleMerge() {
    if (!sourceUser) return;
    if (
      !confirm(
        `Merge ${sourceUser.email} into this account? Its memberships, working groups, roles, and passkeys transfer here, its email is kept as a secondary email, and that account is anonymized. This cannot be undone from the UI.`,
      )
    ) {
      return;
    }
    setMerging(true);
    try {
      await api(`/api/v1/admin/users/${userId}/merge`, {
        method: "POST",
        body: JSON.stringify({ sourceUserId: sourceUser.id }),
      });
      toast("Accounts merged", "success");
      setSourceUser(null);
      await onMerged();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setMerging(false);
    }
  }

  return (
    <div class="card border-0 shadow-sm mt-4">
      <div class="card-header bg-white fw-semibold">Merge another account into this one</div>
      <div class="card-body p-3">
        <div class="small text-muted mb-2">
          Use this to fold a duplicate account into this one — its memberships, working groups, roles, and passkeys
          transfer here, and its email is kept as a secondary email above.
        </div>
        <div class="d-flex gap-2 align-items-end">
          <div style={{ maxWidth: "320px", flex: 1 }}>
            <UserPicker
              value={sourceUser}
              onChange={setSourceUser}
              disabled={merging}
              placeholder="Find the duplicate account…"
            />
          </div>
          <button class="btn btn-sm btn-danger" disabled={merging || !sourceUser} onClick={() => void handleMerge()}>
            {merging ? "Merging…" : "Merge into this account"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────
// User detail component
// ────────────────────────────────────────────────────────

export function UserDetailView({ userId, onBack }: { userId: string; onBack: () => void }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<UserDetail | null>(null);
  const [headshotStatus, setHeadshotStatus] = useState("");
  const [editing, setEditing] = useState(false);
  const [editError, setEditError] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const editLinksRef = useRef<ProfileLinksHandle>(null);
  const [editForm, setEditForm] = useState<{
    email: string;
    firstName: string;
    lastName: string;
    preferredName: string;
    organizationName: string;
    jobTitle: string;
    biography: string;
    links: string[];
    role: string;
    active: boolean;
    isEcMember: boolean;
  } | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api<{ user: UserDetail }>(`/api/v1/admin/users/${userId}`);
      setUser(data.user);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!user) return;
    setHeadshotStatus(
      user.headshot_updated_at ? `Updated: ${new Date(user.headshot_updated_at).toLocaleString("en-GB")}` : "",
    );
  }, [user]);

  useEffect(() => {
    if (!editing || !editForm) return;
    editLinksRef.current?.setLinks(editForm.links);
  }, [editing, editForm?.links]);

  async function uploadHeadshotFile(uid: string, file: Blob) {
    const headers: Record<string, string> = { "Content-Type": file.type || "application/octet-stream" };
    const res = await fetch(`/api/v1/admin/users/${uid}/headshot`, {
      method: "PUT",
      credentials: "same-origin",
      headers,
      body: file,
    });
    const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    if (!res.ok) throw new Error(data.error?.message ?? `HTTP ${res.status}`);
  }

  async function deleteHeadshotFile(uid: string) {
    await api(`/api/v1/admin/users/${uid}/headshot`, { method: "DELETE" });
  }

  function startEditing() {
    if (!user) return;
    setEditForm({
      email: user.email,
      firstName: user.first_name ?? "",
      lastName: user.last_name ?? "",
      preferredName: user.preferred_name ?? "",
      organizationName: user.organization_name ?? "",
      jobTitle: user.job_title ?? "",
      biography: user.biography ?? "",
      links: normalizeProfileLinks(user.links),
      role: user.role,
      active: user.active,
      isEcMember: user.isEcMember ?? false,
    });
    setEditError("");
    setEditing(true);
  }

  async function saveEdit() {
    if (!user || !editForm) return;
    setEditSaving(true);
    setEditError("");
    try {
      await api(`/api/v1/admin/users/${user.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          email: editForm.email.trim().toLowerCase() || undefined,
          firstName: editForm.firstName || null,
          lastName: editForm.lastName || null,
          preferredName: editForm.preferredName || null,
          organizationName: editForm.organizationName || null,
          jobTitle: editForm.jobTitle || null,
          biography: editForm.biography || null,
          links: editLinksRef.current?.getLinks() ?? editForm.links,
          role: editForm.role,
          active: editForm.active,
          isEcMember: editForm.isEcMember,
        }),
      });
      toast("User updated", "success");
      setEditing(false);
      await load();
    } catch (e) {
      setEditError((e as Error).message);
    } finally {
      setEditSaving(false);
    }
  }

  async function fetchGravatar() {
    if (!user) return;
    const accepted = await confirmHeadshotUsage({
      title: "Before uploading a photo",
      texts: ADMIN_HEADSHOT_DISCLAIMER,
      confirmText: "Proceed",
    });
    if (!accepted) return;
    setHeadshotStatus("Looking up Gravatar...");
    try {
      await api(`/api/v1/admin/users/${user.id}/gravatar`, { method: "POST" });
      toast("Gravatar imported successfully", "success");
      await load();
    } catch (e) {
      toast((e as Error).message, "error");
      setHeadshotStatus(`Error: ${(e as Error).message}`);
    }
  }

  if (loading) return <Spinner />;
  if (error) return <ErrorAlert error={error} />;
  if (!user) return null;

  const displayName = [user.first_name, user.last_name].filter(Boolean).join(" ") || user.email;
  const profileLinks = normalizeProfileLinks(user.links);

  return (
    <div>
      <div class="d-flex align-items-center gap-2 mb-3">
        <button class="btn btn-sm btn-outline-secondary" onClick={onBack}>
          ← Back to list
        </button>
        <span class="page-heading mb-0">{displayName}</span>
      </div>
      <div class="row g-4">
        <div class="col-md-4 text-center">
          <AdminHeadshotManager
            initialUrl={user.headshotUrl}
            alt="Headshot"
            emptyLabel="User"
            statusText={headshotStatus}
            uploadHeadshot={(file) => uploadHeadshotFile(user.id, file)}
            deleteHeadshot={() => deleteHeadshotFile(user.id)}
            onFetchGravatar={fetchGravatar}
            onUploaded={async () => {
              toast("Headshot uploaded", "success");
              await load();
            }}
            onDeleted={async () => {
              toast("Headshot removed", "success");
              await load();
            }}
            onError={(message) => {
              toast(message, "error");
            }}
            confirmDeleteMessage="Remove this user's headshot?"
          />
        </div>
        <div class="col-md-8">
          <div class="card border-0 shadow-sm">
            <div class="card-body p-3">
              {!editing ? (
                <>
                  <table class="table table-sm table-borderless mb-0">
                    <tbody>
                      {(
                        [
                          ["Email", user.email],
                          ["First name", user.first_name],
                          ["Last name", user.last_name],
                          ["Preferred name", user.preferred_name],
                          ["Organisation", user.organization_name],
                          ["Job title", user.job_title],
                        ] as Array<[string, string | null | undefined]>
                      ).map(([label, value]) => (
                        <tr key={label}>
                          <th class="text-muted small adm-user-info-label">{label}</th>
                          <td>{value || "—"}</td>
                        </tr>
                      ))}
                      <tr>
                        <th class="text-muted small adm-user-info-label">Role</th>
                        <td>
                          <span class={`badge text-bg-${ROLE_COLOR[user.role] ?? "secondary"}`}>{user.role}</span>
                        </td>
                      </tr>
                      <tr>
                        <th class="text-muted small adm-user-info-label">Active</th>
                        <td>
                          {user.active ? (
                            <span class="badge text-bg-success">Yes</span>
                          ) : (
                            <span class="badge text-bg-danger">No</span>
                          )}
                        </td>
                      </tr>
                      <tr>
                        <th class="text-muted small adm-user-info-label">Executive Council</th>
                        <td>
                          {user.isEcMember ? (
                            <span class="badge text-bg-success">Yes</span>
                          ) : (
                            <span class="text-muted">No</span>
                          )}
                        </td>
                      </tr>
                      <tr>
                        <th class="text-muted small adm-user-info-label">Created</th>
                        <td>{user.created_at ? new Date(user.created_at).toLocaleString("en-GB") : "—"}</td>
                      </tr>
                      <tr>
                        <th class="text-muted small adm-user-info-label">Updated</th>
                        <td>{user.updated_at ? new Date(user.updated_at).toLocaleString("en-GB") : "—"}</td>
                      </tr>
                      {user.biography && (
                        <tr>
                          <th class="text-muted small adm-user-info-label">Biography</th>
                          <td class="small">{user.biography}</td>
                        </tr>
                      )}
                      {profileLinks.length > 0 && (
                        <tr>
                          <th class="text-muted small adm-user-info-label">Links</th>
                          <td class="small">
                            <div class="d-flex flex-column gap-1">
                              {profileLinks.map((url) => (
                                <a key={url} href={url} target="_blank" rel="noreferrer">
                                  {url}
                                </a>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )}
                      {user.pii_redacted_at && (
                        <tr>
                          <th class="text-muted small adm-user-info-label">PII redacted</th>
                          <td class="text-danger">{new Date(user.pii_redacted_at).toLocaleString("en-GB")}</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                  {!user.pii_redacted_at && (
                    <div class="mt-3">
                      <button class="btn btn-sm btn-outline-primary" onClick={startEditing}>
                        Edit
                      </button>
                    </div>
                  )}
                </>
              ) : (
                editForm && (
                  <div>
                    <div class="row g-2 mb-2">
                      {(
                        [
                          ["First name", "firstName"],
                          ["Last name", "lastName"],
                          ["Preferred name", "preferredName"],
                          ["Organisation", "organizationName"],
                          ["Job title", "jobTitle"],
                        ] as Array<[string, keyof typeof editForm]>
                      ).map(([label, field]) => (
                        <div key={field} class="col-sm-6">
                          <label class="form-label small mb-1">{label}</label>
                          <input
                            type="text"
                            class="form-control form-control-sm"
                            value={editForm[field] as string}
                            onInput={(e) =>
                              setEditForm((f) => f && { ...f, [field]: (e.target as HTMLInputElement).value })
                            }
                            disabled={editSaving}
                          />
                        </div>
                      ))}
                      <div class="col-12">
                        <label class="form-label small mb-1">Biography</label>
                        <textarea
                          class="form-control form-control-sm"
                          rows={4}
                          value={editForm.biography}
                          onInput={(e) =>
                            setEditForm((f) => f && { ...f, biography: (e.target as HTMLTextAreaElement).value })
                          }
                          disabled={editSaving}
                        />
                      </div>
                      <div class="col-12">
                        <label class="form-label small mb-1">Profile links</label>
                        <ProfileLinksInput ref={editLinksRef} fieldName="adminUserProfileLink" max={15} />
                      </div>
                      <div class="col-12">
                        <label class="form-label small mb-1">Email</label>
                        <input
                          type="email"
                          class="form-control form-control-sm"
                          value={editForm.email}
                          onInput={(e) =>
                            setEditForm((f) => f && { ...f, email: (e.target as HTMLInputElement).value })
                          }
                          disabled={editSaving}
                        />
                        <div class="form-text">
                          Changing the email address affects login. Existing sessions remain valid.
                        </div>
                      </div>
                      <div class="col-sm-6">
                        <div class="form-label small mb-1">Role</div>
                        <div class="d-flex gap-3">
                          {adminRoleValueSchema.options.map((r) => (
                            <div key={r} class="form-check mb-0">
                              <input
                                class="form-check-input"
                                type="radio"
                                id={`edit-role-${r}`}
                                name="edit-role"
                                value={r}
                                checked={editForm.role === r}
                                onChange={() => setEditForm((f) => f && { ...f, role: r })}
                                disabled={editSaving}
                              />
                              <label class="form-check-label small" for={`edit-role-${r}`}>
                                {r}
                              </label>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div class="col-sm-6">
                        <div class="form-check mt-4">
                          <input
                            class="form-check-input"
                            type="checkbox"
                            id="edit-active"
                            checked={editForm.active}
                            onChange={(e) =>
                              setEditForm((f) => f && { ...f, active: (e.target as HTMLInputElement).checked })
                            }
                            disabled={editSaving}
                          />
                          <label class="form-check-label small" for="edit-active">
                            Active
                          </label>
                        </div>
                      </div>
                      <div class="col-sm-6">
                        <div class="form-check mt-2">
                          <input
                            class="form-check-input"
                            type="checkbox"
                            id="edit-ec-member"
                            checked={editForm.isEcMember}
                            onChange={(e) =>
                              setEditForm((f) => f && { ...f, isEcMember: (e.target as HTMLInputElement).checked })
                            }
                            disabled={editSaving}
                          />
                          <label class="form-check-label small" for="edit-ec-member">
                            Executive Council member
                          </label>
                        </div>
                      </div>
                    </div>
                    <hr class="my-3" />
                    {editError && <div class="alert alert-danger small py-2 mb-2">{editError}</div>}
                    <div class="d-flex gap-2">
                      <button class="btn btn-sm btn-primary" onClick={() => void saveEdit()} disabled={editSaving}>
                        {editSaving ? "Saving…" : "Save"}
                      </button>
                      <button
                        class="btn btn-sm btn-outline-secondary"
                        onClick={() => setEditing(false)}
                        disabled={editSaving}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )
              )}
            </div>
          </div>
        </div>
      </div>
      <MembershipPanel user={user} onChanged={load} />
      <EmailAddressesPanel userId={user.id} primaryEmail={user.email} />
      <MergeAccountPanel userId={user.id} onMerged={load} />
    </div>
  );
}

// ────────────────────────────────────────────────────────
// User list component
// ────────────────────────────────────────────────────────

function UserList({ onViewUser }: { onViewUser: (id: string) => void }) {
  const [roleFilter, setRoleFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const tableRef = useRef<ApiTableActions | null>(null);

  async function updateRole(userId: string, newRole: string, select: HTMLSelectElement) {
    const prev = select.dataset.currentRole ?? select.value;
    try {
      await api(`/api/v1/admin/users/${userId}`, { method: "PATCH", body: JSON.stringify({ role: newRole }) });
      select.dataset.currentRole = newRole;
      toast(`Role updated to '${newRole}'`, "success");
    } catch (e) {
      toast((e as Error).message, "error");
      select.value = prev;
    }
  }

  return (
    <ApiDataTable<AdminUser>
      endpoint="/api/v1/admin/users"
      resolve={(d) => (d as { users: AdminUser[] }).users}
      resolvePage={(d) => (d as { page: { total: number; hasMore: boolean } }).page}
      paginate
      actionsRef={tableRef}
      searchPlaceholder="email or name"
      params={{ ...(roleFilter ? { role: roleFilter } : {}), ...(typeFilter ? { type: typeFilter } : {}) }}
      deps={[roleFilter, typeFilter]}
      toolbar={({ resetPage }) => (
        <>
          <select
            class="form-select form-select-sm w-auto"
            value={roleFilter}
            onChange={(e) => {
              setRoleFilter((e.target as HTMLSelectElement).value);
              resetPage();
            }}
          >
            <option value="">All roles</option>
            <option value="admin">Admin</option>
            <option value="user">User</option>
            <option value="guest">Guest</option>
          </select>
          <select
            class="form-select form-select-sm w-auto"
            value={typeFilter}
            onChange={(e) => {
              setTypeFilter((e.target as HTMLSelectElement).value);
              resetPage();
            }}
          >
            <option value="">All types</option>
            <option value="member">Members</option>
            <option value="event_attendee">Event attendees</option>
            <option value="contact_only">Contacts only</option>
          </select>
        </>
      )}
      columns={[
        {
          header: "Email",
          cell: (user) => <span>{user.email}</span>,
          className: "mono adm-user-email",
          sort: { asc: "email", desc: "-email" },
        },
        {
          header: "Name",
          cell: (user) => [user.first_name, user.last_name].filter(Boolean).join(" ") || "—",
          className: "fw-semibold",
          sort: { asc: "last_name", desc: "-last_name" },
        },
        {
          header: "Organisation",
          cell: (user) => user.organization_name ?? "—",
          className: "small text-muted",
          sort: { asc: "organization_name", desc: "-organization_name" },
        },
        {
          header: "Type",
          cell: (user) => {
            if (user.membership) {
              return (
                <>
                  <span class="badge text-bg-success mono">{user.membership.membershipCategory}</span>
                  {user.membership.organizationName && (
                    <>
                      {" "}
                      <span class="small text-muted">{user.membership.organizationName}</span>
                    </>
                  )}
                </>
              );
            }
            if (user.type === "event_attendee") {
              return (
                <span class="badge text-bg-info">
                  Event attendee · {user.eventParticipationCount} event{user.eventParticipationCount === 1 ? "" : "s"}
                </span>
              );
            }
            return <span class="text-muted small fst-italic">Contact</span>;
          },
        },
        {
          header: "Links",
          cell: (user) => {
            const count = normalizeProfileLinks(user.links).length;
            return count > 0 ? (
              <span class="badge text-bg-info" title={`${count} profile link${count === 1 ? "" : "s"}`}>
                {count}
              </span>
            ) : (
              <span class="text-muted small">—</span>
            );
          },
          className: "text-center",
        },
        {
          header: "Role",
          cell: (user) => <span class={`badge text-bg-${ROLE_COLOR[user.role] ?? "secondary"}`}>{user.role}</span>,
          sort: { asc: "role", desc: "-role" },
        },
        {
          header: "Since",
          cell: (user) => fmt(user.created_at),
          className: "mono",
          sort: { asc: "created_at", desc: "-created_at", defaultDirection: "desc" },
        },
        {
          header: "",
          cell: (user) => (
            <div onClick={(e) => e.stopPropagation()}>
              <select
                class="form-select form-select-sm d-inline-block adm-user-role-select"
                value={user.role}
                data-current-role={user.role}
                onChange={(e) => {
                  e.stopPropagation();
                  void updateRole(user.id, (e.target as HTMLSelectElement).value, e.target as HTMLSelectElement);
                }}
              >
                <option value="admin">admin</option>
                <option value="user">user</option>
                <option value="guest">guest</option>
              </select>
            </div>
          ),
        },
      ]}
      empty="No users found"
      rowKey={(user) => user.id}
      rowClass={() => "adm-user-row"}
      onRowClick={(user) => onViewUser(user.id)}
    />
  );
}

// ────────────────────────────────────────────────────────
// Main section
// ────────────────────────────────────────────────────────

export function Users() {
  const [, navigate] = useHashLocation();
  // Row clicks navigate to a real /users/detail/:id route (AdminShell.tsx),
  // matching Donations' /donations/detail/:id pattern, so a user's detail
  // page is linkable/shareable instead of only reachable via in-page state
  // (also what Organizations.tsx's representative rows link to — see B3).
  return <UserList onViewUser={(id) => navigate(`/users/detail/${id}`)} />;
}
