import { useState, useRef } from "preact/hooks";
import { ApiDataTable, type ApiTableActions } from "../../../../components/Table";
import { api } from "../../../api";
import { toast } from "../../../ui";
import type { EventPermission } from "../../../types";

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
  const [adding, setAdding] = useState(false);
  const [addStatus, setAddStatus] = useState("");

  async function handleRevoke(permId: string) {
    if (!confirm("Remove this team member?")) return;
    try {
      await api(`/api/v1/admin/events/${slug}/permissions/${permId}`, { method: "DELETE" });
      toast("Permission revoked", "success");
      tableRef.current?.reload();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  async function handleAdd(e: Event) {
    e.preventDefault();
    if (!newEmail.trim()) return;
    setAdding(true);
    setAddStatus("Adding…");
    try {
      await api(`/api/v1/admin/events/${slug}/permissions`, {
        method: "POST",
        body: JSON.stringify({ userEmail: newEmail.trim(), permission: newPerm }),
      });
      toast("Permission added", "success");
      setNewEmail("");
      setAddStatus("");
      tableRef.current?.reload();
    } catch (e) {
      const msg = (e as Error).message;
      setAddStatus(msg);
      toast(msg, "error");
    } finally {
      setAdding(false);
    }
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
            <button type="submit" class="btn btn-sm btn-success" disabled={adding}>
              Add
            </button>
            {addStatus && <span class="small text-danger">{addStatus}</span>}
          </form>
        </div>
      </div>

      <ApiDataTable<EventPermission>
        endpoint={`/api/v1/admin/events/${slug}/permissions`}
        resolve={(d) => (d as { permissions: EventPermission[] }).permissions}
        actionsRef={tableRef}
        deps={[slug]}
        columns={[
          { header: "Email", cell: (p) => p.user_email },
          {
            header: "Permission",
            cell: (p) => <span class="badge text-bg-secondary">{PERM_LABELS[p.permission] ?? p.permission}</span>,
          },
          { header: "Added by", cell: (p) => p.granter_email ?? "—", className: "small text-muted" },
          {
            header: "Added",
            cell: (p) => (p.created_at ? p.created_at.substring(0, 10) : "—"),
            className: "mono small",
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
