import { h, Fragment } from "preact";
import { useState, useEffect, useCallback, useRef } from "preact/hooks";
import { Badge } from "../../components/Badge";
import { Spinner } from "../../components/Spinner";
import { ErrorAlert } from "../../components/ErrorAlert";
import { api } from "../api";
import { authToken, authEmail as authEmailSignal } from "../state";
import { fmt, toast } from "../ui";
import type { AdminUser } from "../types";
import { wireHeadshotController, confirmHeadshotUsage } from "../../shared/headshot/controller";

// ────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────

interface UserDetail {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
  organization_name: string | null;
  job_title: string | null;
  biography: string | null;
  role: string;
  active: boolean;
  headshot_r2_key: string | null;
  headshot_updated_at: string | null;
  headshotUrl: string | null;
  created_at: string;
  updated_at: string;
  pii_redacted_at: string | null;
}

const ROLE_COLOR: Record<string, string> = { admin: "danger", user: "secondary", guest: "light" };

const HEADSHOT_DISCLAIMER = [
  "This is a photograph of the named individual.",
  "PKI Consortium holds the copyright, or has an unrestricted, royalty-free licence to use and publish this image.",
  "The image does not infringe any third-party intellectual property rights, privacy rights, or applicable laws.",
  "PKI Consortium may display this image alongside the individual's name and professional details on the website and related materials.",
  "I accept full responsibility for any claims arising from this upload.",
];

// ────────────────────────────────────────────────────────
// User detail component
// ────────────────────────────────────────────────────────

function UserDetailView({ userId, onBack }: { userId: string; onBack: () => void }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<UserDetail | null>(null);
  const [headshotStatus, setHeadshotStatus] = useState("");

  const headshotPreviewRef = useRef<HTMLDivElement>(null);
  const headshotFileRef = useRef<HTMLInputElement>(null);
  const headshotDeleteRef = useRef<HTMLButtonElement>(null);

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

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!user) return;
    setHeadshotStatus(user.headshot_updated_at ? `Updated: ${new Date(user.headshot_updated_at).toLocaleString("en-GB")}` : "");

    wireHeadshotController({
      preview: headshotPreviewRef.current,
      status: null,
      fileInput: headshotFileRef.current,
      deleteButton: headshotDeleteRef.current,
      initialUrl: user.headshotUrl,
      previewOptions: {
        alt: "Headshot",
        emptyLabel: "User",
        containerClass: "adm-headshot-preview",
        imageClass: ["rounded-circle", "border", "shadow-sm", "adm-headshot-preview-img"],
        placeholderClass: ["rounded-circle", "border", "bg-light", "d-flex", "align-items-center", "justify-content-center", "mx-auto", "adm-headshot-placeholder"],
      },
      disclaimerOptions: {
        title: "Before uploading a photo",
        texts: HEADSHOT_DISCLAIMER,
        confirmText: "Proceed",
      },
      uploadSuccessStatus: "Headshot uploaded",
      deleteSuccessStatus: "Headshot removed",
      confirmDeleteMessage: "Remove this user's headshot?",
      resetListeners: true,
      uploadHeadshot: (file) => uploadHeadshotFile(user.id, file),
      deleteHeadshot: () => deleteHeadshotFile(user.id),
      onUploaded: async () => {
        toast("Headshot uploaded", "success");
        await load();
      },
      onDeleted: async () => {
        toast("Headshot removed", "success");
        await load();
      },
      onError: (message) => {
        toast(message, "error");
      },
    });
  }, [user, load]);

  async function uploadHeadshotFile(uid: string, file: Blob) {
    const headers: Record<string, string> = { "Content-Type": file.type || "application/octet-stream" };
    const token = authToken.value;
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const res = await fetch(`/api/v1/admin/users/${uid}/headshot`, { method: "PUT", headers, body: file });
    const data = await res.json().catch(() => ({})) as { error?: { message?: string } };
    if (!res.ok) throw new Error(data.error?.message ?? `HTTP ${res.status}`);
  }

  async function deleteHeadshotFile(uid: string) {
    await api(`/api/v1/admin/users/${uid}/headshot`, { method: "DELETE" });
  }

  async function fetchGravatar() {
    if (!user) return;
    const accepted = await confirmHeadshotUsage({ title: "Before uploading a photo", texts: HEADSHOT_DISCLAIMER, confirmText: "Proceed" });
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

  return (
    <div>
      <div class="d-flex align-items-center gap-2 mb-3">
        <button class="btn btn-sm btn-outline-secondary" onClick={onBack}>← Back to list</button>
        <span class="page-heading mb-0">{displayName}</span>
      </div>
      <div class="row g-4">
        <div class="col-md-4 text-center">
          <div class="mb-3">
            <div ref={headshotPreviewRef} class="mb-2"></div>
            <div class="d-flex flex-column gap-2 align-items-center">
              <label class="btn btn-sm btn-outline-primary w-100 adm-headshot-btn">
                📷 Upload headshot
                <input ref={headshotFileRef} type="file" accept="image/jpeg,image/png,image/webp" class="d-none" />
              </label>
              <button class="btn btn-sm btn-outline-secondary w-100 adm-headshot-btn" onClick={() => void fetchGravatar()}>
                🌐 Fetch from Gravatar
              </button>
              <button ref={headshotDeleteRef} class="btn btn-sm btn-outline-danger w-100 adm-headshot-btn d-none">
                🗑 Remove headshot
              </button>
            </div>
            {headshotStatus && <div class="mt-2 small text-muted">{headshotStatus}</div>}
          </div>
        </div>
        <div class="col-md-8">
          <div class="card border-0 shadow-sm">
            <div class="card-body p-3">
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
                    <td><span class={`badge text-bg-${ROLE_COLOR[user.role] ?? "secondary"}`}>{user.role}</span></td>
                  </tr>
                  <tr>
                    <th class="text-muted small adm-user-info-label">Active</th>
                    <td>{user.active ? <span class="badge text-bg-success">Yes</span> : <span class="badge text-bg-danger">No</span>}</td>
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
                  {user.pii_redacted_at && (
                    <tr>
                      <th class="text-muted small adm-user-info-label">PII redacted</th>
                      <td class="text-danger">{new Date(user.pii_redacted_at).toLocaleString("en-GB")}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────
// User list component
// ────────────────────────────────────────────────────────

function UserList({ onViewUser }: { onViewUser: (id: string) => void }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [roleFilter, setRoleFilter] = useState("");
  const [searchQ, setSearchQ] = useState("");

  const load = useCallback(async (role?: string, q?: string) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (role) params.set("role", role);
      if (q) params.set("search", q);
      const data = await api<{ users: AdminUser[] }>(`/api/v1/admin/users${params.toString() ? `?${params}` : ""}`);
      setUsers(data.users ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  function handleSearch() {
    void load(roleFilter, searchQ);
  }

  function handleSearchKey(e: KeyboardEvent) {
    if ((e as KeyboardEvent).key === "Enter") handleSearch();
  }

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

  if (loading) return <Spinner />;
  if (error) return <ErrorAlert error={error} />;

  return (
    <div>
      <div class="mb-3 d-flex gap-2 flex-wrap align-items-end">
        <div>
          <label class="form-label small fw-semibold mb-1">Filter by role</label>
          <select
            class="form-select form-select-sm"
            value={roleFilter}
            onChange={(e) => {
              const val = (e.target as HTMLSelectElement).value;
              setRoleFilter(val);
              void load(val, searchQ);
            }}
          >
            <option value="">All</option>
            <option value="admin">Admin</option>
            <option value="user">User</option>
            <option value="guest">Guest</option>
          </select>
        </div>
        <div>
          <label class="form-label small fw-semibold mb-1">Search</label>
          <input
            class="form-control form-control-sm"
            type="search"
            placeholder="email or name"
            value={searchQ}
            onInput={(e) => setSearchQ((e.target as HTMLInputElement).value)}
            onKeyDown={handleSearchKey}
          />
        </div>
        <button class="btn btn-sm btn-outline-secondary" onClick={handleSearch}>Search</button>
      </div>

      <div class="table-responsive">
        <table class="table table-sm table-hover">
          <thead>
            <tr><th>Email</th><th>Name</th><th>Organisation</th><th>Role</th><th>Since</th><th></th></tr>
          </thead>
          <tbody>
            {users.length === 0 ? (
              <tr><td colSpan={6} class="text-center text-muted fst-italic py-3">No users found</td></tr>
            ) : users.map((user) => {
              const name = [user.first_name, user.last_name].filter(Boolean).join(" ") || "—";
              return (
                <tr key={user.id} class="adm-user-row" style="cursor:pointer" onClick={() => onViewUser(user.id)}>
                  <td class="mono adm-user-email">
                    <a
                      href={`mailto:${user.email}`}
                      class="text-decoration-none"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {user.email}
                    </a>
                  </td>
                  <td class="fw-semibold">{name}</td>
                  <td class="small text-muted">{user.organization_name ?? "—"}</td>
                  <td>
                    <span class={`badge text-bg-${ROLE_COLOR[user.role] ?? "secondary"}`}>{user.role}</span>
                  </td>
                  <td class="mono">{fmt(user.created_at)}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <select
                      class="form-select form-select-sm d-inline-block"
                      style="width:auto"
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
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────
// Main section
// ────────────────────────────────────────────────────────

export function Users() {
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  if (selectedUserId) {
    return <UserDetailView userId={selectedUserId} onBack={() => setSelectedUserId(null)} />;
  }
  return <UserList onViewUser={(id) => setSelectedUserId(id)} />;
}
