import { useState, useEffect, useCallback, useRef } from "preact/hooks";
import { useHashLocation } from "wouter/use-hash-location";
import { Spinner } from "../../components/Spinner";
import { ErrorAlert } from "../../components/ErrorAlert";
import { api } from "../api";
import { toast } from "../ui";
import { confirmHeadshotUsage } from "../../shared/headshot/controller";
import { AdminHeadshotManager, ADMIN_HEADSHOT_DISCLAIMER } from "../../shared/headshot/AdminHeadshotManager";
import { ProfileLinksInput, type ProfileLinksHandle } from "../../components/ProfileLinksInput";
import { normalizeProfileLinks } from "../../shared/widgets/profile-links";
import { adminRoleValueSchema } from "../../../shared/schemas/admin-users";
import { UserList } from "./users/UserList";

import type { UserDetail } from "./users/model";
import { UserMembershipPanel } from "./users/UserMembershipPanel";
import { UserEmailAddressesPanel } from "./users/UserAccountPanels";

const ROLE_COLOR: Record<string, string> = { admin: "danger", user: "secondary", guest: "light" };
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
      user.headshot_updated_at ? `Updated: ${new Date(user.headshot_updated_at).toLocaleString("en-US")}` : "",
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
                          ["Organization", user.organization_name],
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
                        <td>{user.created_at ? new Date(user.created_at).toLocaleString("en-US") : "—"}</td>
                      </tr>
                      <tr>
                        <th class="text-muted small adm-user-info-label">Updated</th>
                        <td>{user.updated_at ? new Date(user.updated_at).toLocaleString("en-US") : "—"}</td>
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
                          <td class="text-danger">{new Date(user.pii_redacted_at).toLocaleString("en-US")}</td>
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
                          ["Organization", "organizationName"],
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
      <UserMembershipPanel user={user} onChanged={load} />
      <UserEmailAddressesPanel userId={user.id} primaryEmail={user.email} />
    </div>
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
