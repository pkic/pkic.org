import { ApiFn, EventPermission } from "./types";
import { esc, fmt, q, tbl, toast } from "./ui";

export function teamTabHtml(): string {
  return (
    '<div id="team-body"></div>'
  );
}

export async function loadEventPermissions(api: ApiFn, slug: string, spinnerHtml: string): Promise<void> {
  const body = q("#team-body");
  if (!body) return;
  body.innerHTML = spinnerHtml;

  try {
    const d = await api<{ permissions: EventPermission[] }>(`/api/v1/admin/events/${slug}/permissions`);
    const perms = d.permissions ?? [];

    const permLabels: Record<string, string> = {
      organizer: "Organizer",
      program_committee: "Program Committee",
      moderator: "Moderator",
      volunteer: "Volunteer",
    };

    body.innerHTML =
      '<h6 class="text-uppercase small fw-bold text-muted mb-2">Event Team</h6>' +
      tbl(
        ["Email", "Role", "Granted by", "Date", ""],
        perms.map((p) =>
          `<tr>` +
          `<td class="mono" style="font-size:.8rem">${esc(p.user_email)}</td>` +
          `<td><span class="badge text-bg-info">${esc(permLabels[p.permission] ?? p.permission)}</span></td>` +
          `<td class="small text-muted">${esc(p.granter_email ?? "—")}</td>` +
          `<td class="mono">${fmt(p.created_at)}</td>` +
          `<td><button class="btn btn-sm btn-outline-danger p-0 px-1" style="font-size:.75rem" data-revoke-perm="${esc(p.id)}" title="Revoke">✕</button></td>` +
          `</tr>`
        ),
        "No team members assigned",
      ) +
      // Add member form
      '<div class="mt-3 card border-0 bg-light p-3">' +
        '<h6 class="small fw-semibold mb-2">Add team member</h6>' +
        '<div class="row g-2 align-items-end">' +
          '<div class="col-md-5"><label class="form-label small mb-1">Email</label>' +
          '<input class="form-control form-control-sm" id="perm-email" type="email" placeholder="alice@example.com"></div>' +
          '<div class="col-md-4"><label class="form-label small mb-1">Role</label>' +
          '<select class="form-select form-select-sm" id="perm-role">' +
            '<option value="organizer">Organizer</option>' +
            '<option value="program_committee">Program Committee</option>' +
            '<option value="moderator">Moderator</option>' +
            '<option value="volunteer">Volunteer</option>' +
          '</select></div>' +
          '<div class="col-md-3">' +
          '<button class="btn btn-sm btn-success w-100" id="btn-add-perm">Add →</button>' +
          '</div>' +
        '</div>' +
        '<div id="perm-status" class="small mt-2"></div>' +
      '</div>';

    // Wire revoke buttons
    body.querySelectorAll<HTMLButtonElement>("[data-revoke-perm]").forEach((btn) => {
      btn.addEventListener("click", () => void revokePermission(api, slug, btn.dataset.revokePerm!, spinnerHtml));
    });

    // Wire add button
    q("#btn-add-perm")?.addEventListener("click", () => void addPermission(api, slug, spinnerHtml));
  } catch (err) {
    body.innerHTML = `<div class="alert alert-danger">${esc((err as Error).message)}</div>`;
  }
}

async function addPermission(api: ApiFn, slug: string, spinnerHtml: string): Promise<void> {
  const emailEl = q<HTMLInputElement>("#perm-email");
  const roleEl  = q<HTMLSelectElement>("#perm-role");
  const statusEl = q("#perm-status");
  const email = emailEl?.value.trim() ?? "";
  const permission = roleEl?.value ?? "organizer";

  if (!email) { toast("Enter an email address", "error"); return; }

  const btn = q<HTMLButtonElement>("#btn-add-perm");
  if (btn) { btn.disabled = true; btn.textContent = "Adding…"; }
  if (statusEl) statusEl.textContent = "";

  try {
    await api(`/api/v1/admin/events/${slug}/permissions`, {
      method: "POST",
      body: JSON.stringify({ userEmail: email, permission }),
    });
    toast("Team member added", "success");
    void loadEventPermissions(api, slug, spinnerHtml);
  } catch (err) {
    toast((err as Error).message, "error");
    if (statusEl) { statusEl.textContent = (err as Error).message; statusEl.className = "text-danger"; }
    if (btn) { btn.disabled = false; btn.textContent = "Add →"; }
  }
}

async function revokePermission(api: ApiFn, slug: string, permId: string, spinnerHtml: string): Promise<void> {
  try {
    await api(`/api/v1/admin/events/${slug}/permissions/${permId}`, { method: "DELETE" });
    toast("Permission revoked", "success");
    void loadEventPermissions(api, slug, spinnerHtml);
  } catch (err) {
    toast((err as Error).message, "error");
  }
}
