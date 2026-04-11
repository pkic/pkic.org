import { confirmHeadshotUsage, wireHeadshotController } from "../shared/headshot-controller";

export interface AdminUser {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  organization_name: string | null;
  role: string;
  active: number;
  created_at: string;
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
  role: string;
  active: boolean;
  headshot_r2_key: string | null;
  headshot_updated_at: string | null;
  headshotUrl: string | null;
  created_at: string;
  updated_at: string;
  pii_redacted_at: string | null;
}

type ToastType = "success" | "error" | "info";

interface UsersSectionDeps {
  api<T = unknown>(path: string, opts?: RequestInit & { headers?: Record<string, string> }): Promise<T>;
  esc(value: unknown): string;
  fmt(value: string | null | undefined): string;
  getAuthToken(): string | null;
  hide(element: Element | null): void;
  q<T extends Element = Element>(selector: string, context?: ParentNode): T | null;
  show(element: Element | null): void;
  spinner(): string;
  tbl(heads: string[], rows: string[], empty?: string): string;
  toast(message: string, type?: ToastType): void;
}

const ADMIN_HEADSHOT_DISCLAIMER_TEXT = [
  "This is a photograph of the named individual.",
  "PKI Consortium holds the copyright, or has an unrestricted, royalty-free licence to use and publish this image.",
  "The image does not infringe any third-party intellectual property rights, privacy rights, or applicable laws.",
  "PKI Consortium may display this image alongside the individual's name and professional details on the website and related materials.",
  "I accept full responsibility for any claims arising from this upload.",
];

export function createUsersSection(deps: UsersSectionDeps): { loadUsers: () => Promise<void> } {
  const { api, esc, fmt, getAuthToken, hide, q, show, spinner, tbl, toast } = deps;
  const roleColor: Record<string, string> = { admin: "danger", user: "secondary", guest: "light" };
  const roleBadge = (role: string) => `<span class="badge text-bg-${roleColor[role] ?? "secondary"}">${esc(role)}</span>`;

  async function loadUsers(): Promise<void> {
    const el = q("#u-body");
    if (!el) return;
    el.innerHTML = spinner();
    hide(q("#u-detail"));
    show(el);

    try {
      const data = await api<{ users: AdminUser[] }>("/api/v1/admin/users");
      const users = data.users ?? [];

      el.innerHTML =
        '<div class="mb-3 d-flex gap-2 flex-wrap align-items-end">' +
          '<div><label class="form-label small fw-semibold mb-1">Filter by role</label>' +
          '<select class="form-select form-select-sm adm-user-filter-select" id="u-role-filter">' +
            '<option value="">All</option>' +
            '<option value="admin">Admin</option>' +
            '<option value="user">User</option>' +
            '<option value="guest">Guest</option>' +
          '</select></div>' +
          '<div><label class="form-label small fw-semibold mb-1">Search</label>' +
          '<input class="form-control form-control-sm adm-user-search" id="u-search" type="search" placeholder="email or name"></div>' +
          '<button class="btn btn-sm btn-outline-secondary" id="btn-u-search">Search</button>' +
        '</div>' +
        '<div id="u-table">' +
        renderUserTable(users) +
        '</div>';

      wireUserTable(el);

      const doSearch = async () => {
        const role = q<HTMLSelectElement>("#u-role-filter")?.value ?? "";
        const search = q<HTMLInputElement>("#u-search")?.value.trim() ?? "";
        const params = new URLSearchParams();
        if (role) params.set("role", role);
        if (search) params.set("search", search);
        const searchResult = await api<{ users: AdminUser[] }>(`/api/v1/admin/users?${params}`);
        const tableEl = q("#u-table");
        if (tableEl) {
          tableEl.innerHTML = renderUserTable(searchResult.users ?? []);
          wireUserTable(el);
        }
      };

      q("#btn-u-search")?.addEventListener("click", () => void doSearch());
      q("#u-search")?.addEventListener("keydown", (event) => {
        if ((event as KeyboardEvent).key === "Enter") void doSearch();
      });
    } catch (err) {
      el.innerHTML = `<div class="alert alert-danger">${esc((err as Error).message)}</div>`;
    }
  }

  function renderUserTable(users: AdminUser[]): string {
    return tbl(
      ["Email", "Name", "Organisation", "Role", "Since", ""],
      users.map((user) => {
        const name = [user.first_name, user.last_name].filter(Boolean).join(" ") || "-";
        return (
          `<tr class="adm-user-row" data-view-user="${esc(user.id)}">` +
          `<td class="mono adm-user-email"><a href="mailto:${esc(user.email)}" data-stop-row-open class="text-decoration-none">${esc(user.email)}</a></td>` +
          `<td class="fw-semibold">${esc(name)}</td>` +
          `<td class="small text-muted">${esc(user.organization_name ?? "-")}</td>` +
          `<td>${roleBadge(user.role)}</td>` +
          `<td class="mono">${fmt(user.created_at)}</td>` +
          `<td>` +
            `<select class="form-select form-select-sm d-inline-block adm-user-role-select" data-user-id="${esc(user.id)}" data-current-role="${esc(user.role)}">` +
              `<option value="admin"${user.role === "admin" ? " selected" : ""}>admin</option>` +
              `<option value="user"${user.role === "user" ? " selected" : ""}>user</option>` +
              `<option value="guest"${user.role === "guest" ? " selected" : ""}>guest</option>` +
            `</select>` +
          `</td>` +
          `</tr>`
        );
      }),
      "No users found",
    );
  }

  function wireUserTable(container: Element): void {
    container.querySelectorAll<HTMLSelectElement>("[data-user-id]").forEach((select) => {
      select.addEventListener("click", (event) => event.stopPropagation());
      select.addEventListener("change", (event) => {
        event.stopPropagation();
        void doUpdateUserRole(select.dataset.userId!, select.value, select);
      });
    });

    container.querySelectorAll<HTMLElement>("[data-stop-row-open]").forEach((link) => {
      link.addEventListener("click", (event) => event.stopPropagation());
    });

    container.querySelectorAll<HTMLTableRowElement>("tr[data-view-user]").forEach((row) => {
      row.addEventListener("click", () => void openUserDetail(row.dataset.viewUser!));
    });
  }

  async function doUpdateUserRole(userId: string, newRole: string, select: HTMLSelectElement): Promise<void> {
    const previousRole = select.dataset.currentRole ?? select.value;
    try {
      await api(`/api/v1/admin/users/${userId}`, { method: "PATCH", body: JSON.stringify({ role: newRole }) });
      select.dataset.currentRole = newRole;
      toast(`Role updated to '${newRole}'`, "success");
    } catch (err) {
      toast((err as Error).message, "error");
      select.value = previousRole;
    }
  }

  async function openUserDetail(userId: string): Promise<void> {
    const body = q("#u-body");
    const detail = q("#u-detail");
    if (!body || !detail) return;

    hide(body);
    show(detail);
    const infoEl = q("#u-detail-info");
    const previewEl = q("#u-headshot-preview");
    const titleEl = q("#u-detail-title");
    const statusEl = q("#u-headshot-status");
    if (infoEl) infoEl.innerHTML = spinner();
    if (previewEl) previewEl.innerHTML = "";
    if (statusEl) statusEl.innerHTML = "";

    const backBtn = q("#btn-u-back");
    if (backBtn) {
      const newBack = backBtn.cloneNode(true) as HTMLElement;
      backBtn.replaceWith(newBack);
      newBack.addEventListener("click", () => {
        hide(detail);
        show(body);
      });
    }

    try {
      const data = await api<{ user: UserDetail }>(`/api/v1/admin/users/${userId}`);
      const user = data.user;

      if (titleEl) titleEl.textContent = [user.first_name, user.last_name].filter(Boolean).join(" ") || user.email;

      renderUserInfo(user, infoEl);
      wireHeadshotControls(user);
    } catch (err) {
      if (infoEl) infoEl.innerHTML = `<div class="alert alert-danger">${esc((err as Error).message)}</div>`;
    }
  }

  function renderUserInfo(user: UserDetail, el: Element | null): void {
    if (!el) return;

    const row = (label: string, value: string | null | undefined) =>
      `<tr><th class="text-muted small adm-user-info-label">${esc(label)}</th><td>${esc(value || "-")}</td></tr>`;

    el.innerHTML =
      '<div class="card border-0 shadow-sm"><div class="card-body p-3">' +
      '<table class="table table-sm table-borderless mb-0">' +
      '<tbody>' +
      row("Email", user.email) +
      row("First name", user.first_name) +
      row("Last name", user.last_name) +
      row("Preferred name", user.preferred_name) +
      row("Organisation", user.organization_name) +
      row("Job title", user.job_title) +
      `<tr><th class="text-muted small adm-user-info-label">Role</th><td><span class="badge text-bg-${roleColor[user.role] ?? "secondary"}">${esc(user.role)}</span></td></tr>` +
      `<tr><th class="text-muted small adm-user-info-label">Active</th><td>${user.active ? '<span class="badge text-bg-success">Yes</span>' : '<span class="badge text-bg-danger">No</span>'}</td></tr>` +
      row("Created", user.created_at ? new Date(user.created_at).toLocaleString("en-GB") : null) +
      row("Updated", user.updated_at ? new Date(user.updated_at).toLocaleString("en-GB") : null) +
      (user.biography ? `<tr><th class="text-muted small adm-user-info-label">Biography</th><td class="small">${esc(user.biography)}</td></tr>` : "") +
      (user.pii_redacted_at ? `<tr><th class="text-muted small adm-user-info-label">PII redacted</th><td class="text-danger">${esc(new Date(user.pii_redacted_at).toLocaleString("en-GB"))}</td></tr>` : "") +
      '</tbody></table></div></div>';
  }

  function renderHeadshotUpdatedStatus(user: UserDetail): void {
    if (user.headshot_updated_at) {
      const statusEl = q("#u-headshot-status");
      if (statusEl) statusEl.textContent = `Updated: ${new Date(user.headshot_updated_at).toLocaleString("en-GB")}`;
    }
  }

  function confirmAdminHeadshotUsage(): Promise<boolean> {
    return confirmHeadshotUsage({
      title: "Before uploading a photo",
      texts: ADMIN_HEADSHOT_DISCLAIMER_TEXT,
      confirmText: "Proceed",
    });
  }

  function wireHeadshotControls(user: UserDetail): void {
    wireHeadshotController({
      preview: q<HTMLElement>("#u-headshot-preview"),
      status: q<HTMLElement>("#u-headshot-status"),
      fileInput: q<HTMLInputElement>("#u-headshot-file"),
      deleteButton: q<HTMLButtonElement>("#btn-u-headshot-delete"),
      initialUrl: user.headshotUrl,
      previewOptions: {
        alt: "Headshot",
        emptyLabel: "User",
        containerClass: "adm-headshot-preview",
        imageClass: ["rounded-circle", "border", "shadow-sm", "adm-headshot-preview-img"],
        placeholderClass: [
          "rounded-circle",
          "border",
          "bg-light",
          "d-flex",
          "align-items-center",
          "justify-content-center",
          "mx-auto",
          "adm-headshot-placeholder",
        ],
      },
      disclaimerOptions: {
        title: "Before uploading a photo",
        texts: ADMIN_HEADSHOT_DISCLAIMER_TEXT,
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
        await openUserDetail(user.id);
      },
      onDeleted: async () => {
        toast("Headshot removed", "success");
        await openUserDetail(user.id);
      },
      onError: (message) => {
        toast(message, "error");
      },
    });

    renderHeadshotUpdatedStatus(user);

    const gravatarBtn = q("#btn-u-gravatar");
    if (gravatarBtn) {
      const newBtn = gravatarBtn.cloneNode(true) as HTMLElement;
      gravatarBtn.replaceWith(newBtn);
      newBtn.addEventListener("click", () => {
        void (async () => {
          const accepted = await confirmAdminHeadshotUsage();
          if (accepted) void fetchGravatar(user.id);
        })();
      });
    }
  }

  async function uploadHeadshotFile(userId: string, file: Blob): Promise<void> {
    const headers: Record<string, string> = { "Content-Type": file.type || "application/octet-stream" };
    const token = getAuthToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const res = await fetch(`/api/v1/admin/users/${userId}/headshot`, {
      method: "PUT",
      headers,
      body: file,
    });
    const data = await res.json().catch(() => ({})) as { error?: { message?: string } };
    if (!res.ok) throw new Error(data.error?.message ?? `HTTP ${res.status}`);
  }

  async function fetchGravatar(userId: string): Promise<void> {
    const statusEl = q("#u-headshot-status");
    if (statusEl) statusEl.innerHTML = '<span class="text-info">Looking up Gravatar...</span>';

    try {
      await api(`/api/v1/admin/users/${userId}/gravatar`, { method: "POST" });
      toast("Gravatar imported successfully", "success");
      await openUserDetail(userId);
    } catch (err) {
      const message = (err as Error).message;
      toast(message, "error");
      if (statusEl) statusEl.innerHTML = `<span class="text-danger">${esc(message)}</span>`;
    }
  }

  async function deleteHeadshotFile(userId: string): Promise<void> {
    await api(`/api/v1/admin/users/${userId}/headshot`, { method: "DELETE" });
  }

  return { loadUsers };
}
