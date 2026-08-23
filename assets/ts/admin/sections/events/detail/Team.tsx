import { useState, useRef } from "preact/hooks";
import { ApiDataTable, type ApiTableActions } from "../../../components/ApiDataTable";
import { apiCommand } from "../../../api";
import { fmt } from "../../../ui";
import type { EventPermission } from "../../../types";
import { adminEventTeamListResponseSchema } from "../../../../../shared/schemas/admin-events";
import { performAdminAction } from "../../../actions";

const PERM_LABELS: Record<string, string> = {
  organizer: "Organizer",
  program_committee: "Program Committee",
  moderator: "Moderator",
  volunteer: "Volunteer",
};

export function Team({ slug }: { slug: string }) {
  const tableRef = useRef<ApiTableActions | null>(null);
  const [newEmail, setNewEmail] = useState("");
  const [newPerm, setNewPerm] = useState("organizer");
  const [newExpiresAt, setNewExpiresAt] = useState("");
  const [adding, setAdding] = useState(false);
  const [addStatus, setAddStatus] = useState("");

  async function handleRevoke(permId: string) {
    if (!confirm("Remove this team member?")) return;
    await performAdminAction({
      request: () => apiCommand(`/api/v1/admin/events/${slug}/permissions/${permId}`, { method: "DELETE" }),
      successMessage: "Permission revoked",
      afterSuccess: () => tableRef.current?.reload(),
    });
  }

  async function handleAdd(e: Event) {
    e.preventDefault();
    if (!newEmail.trim()) return;
    setAddStatus("Adding…");
    await performAdminAction({
      setBusy: setAdding,
      request: () =>
        apiCommand(`/api/v1/admin/events/${slug}/permissions`, {
          method: "POST",
          body: JSON.stringify({
            userEmail: newEmail.trim(),
            permission: newPerm,
            expiresAt: newExpiresAt ? new Date(newExpiresAt).toISOString() : undefined,
          }),
        }),
      successMessage: "Permission added",
      afterSuccess: () => {
        setNewEmail("");
        setNewExpiresAt("");
        setAddStatus("");
        tableRef.current?.reload();
      },
      onError: setAddStatus,
    });
  }

  return (
    <div>
      <div class="card border-0 shadow-sm mb-3">
        <div class="card-header bg-white fw-semibold">Add team member</div>
        <div class="card-body">
          <form onSubmit={handleAdd} class="d-flex gap-2 align-items-end flex-wrap">
            <div>
              <label class="form-label small fw-semibold">Email</label>
              <input
                class="form-control form-control-sm"
                type="email"
                value={newEmail}
                onInput={(e) => setNewEmail((e.target as HTMLInputElement).value)}
                placeholder="user@example.com"
                required
              />
            </div>
            <div>
              <label class="form-label small fw-semibold">Permission</label>
              <select
                class="form-select form-select-sm"
                value={newPerm}
                onChange={(e) => setNewPerm((e.target as HTMLSelectElement).value)}
              >
                {Object.entries(PERM_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label class="form-label small fw-semibold">Expires (optional)</label>
              <input
                class="form-control form-control-sm"
                type="datetime-local"
                value={newExpiresAt}
                onInput={(e) => setNewExpiresAt((e.target as HTMLInputElement).value)}
              />
            </div>
            <button type="submit" class="btn btn-sm btn-success" disabled={adding}>
              Add
            </button>
            {addStatus && <span class="small text-danger">{addStatus}</span>}
          </form>
        </div>
      </div>

      <ApiDataTable<EventPermission>
        endpoint={`/api/v1/admin/events/${slug}/permissions`}
        responseSchema={adminEventTeamListResponseSchema}
        resolve={(data) => adminEventTeamListResponseSchema.parse(data).permissions}
        resolvePage={(data) => adminEventTeamListResponseSchema.parse(data).page}
        paginate
        searchPlaceholder="Search email or role…"
        actionsRef={tableRef}
        columns={[
          { header: "Email", cell: (p) => p.user_email, sort: { asc: "user_email", desc: "-user_email" } },
          {
            header: "Permission",
            cell: (p) => <span class="badge text-bg-secondary">{PERM_LABELS[p.permission] ?? p.permission}</span>,
            sort: { asc: "role_id", desc: "-role_id" },
          },
          { header: "Added by", cell: (p) => p.granter_email ?? "—", className: "small text-muted" },
          {
            header: "Added",
            cell: (p) => (p.created_at ? p.created_at.substring(0, 10) : "—"),
            className: "mono small",
            sort: { asc: "created_at", desc: "-created_at", defaultDirection: "desc" },
          },
          {
            header: "Expires",
            cell: (p) =>
              p.expires_at ? (
                <span class={new Date(p.expires_at).getTime() < Date.now() ? "text-danger" : ""}>
                  {fmt(p.expires_at)}
                </span>
              ) : (
                <span class="text-muted">Never</span>
              ),
            className: "small",
            sort: { asc: "expires_at", desc: "-expires_at" },
          },
          {
            header: "",
            cell: (p) => (
              <button class="btn btn-sm btn-outline-danger" onClick={() => void handleRevoke(p.id)}>
                Revoke
              </button>
            ),
          },
        ]}
        empty="No team members"
        rowKey={(p) => p.id}
      />
    </div>
  );
}
