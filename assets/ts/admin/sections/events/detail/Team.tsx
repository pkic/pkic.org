import { h } from "preact";
import { useState } from "preact/hooks";
import { Spinner } from "../../../../components/Spinner";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { api } from "../../../api";
import { toast } from "../../../ui";
import type { EventPermission } from "../../../types";
import { useData } from "../../../../hooks/useData";

const PERM_LABELS: Record<string, string> = {
  organizer: "Organizer",
  program_committee: "Program Committee",
  moderator: "Moderator",
  volunteer: "Volunteer",
};

export function Team({ slug }: { slug: string }) {
  const { data, loading, error, reload } = useData<{ permissions: EventPermission[] }>(
    () => api<{ permissions: EventPermission[] }>(`/api/v1/admin/events/${slug}/permissions`), [slug],
  );
  const perms = data?.permissions ?? [];
  const [newEmail, setNewEmail] = useState("");
  const [newPerm, setNewPerm] = useState("organizer");
  const [adding, setAdding] = useState(false);
  const [addStatus, setAddStatus] = useState("");

  async function handleRevoke(permId: string) {
    if (!confirm("Remove this team member?")) return;
    try {
      await api(`/api/v1/admin/events/${slug}/permissions/${permId}`, { method: "DELETE" });
      toast("Permission revoked", "success");
      void reload();
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
      void reload();
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
              <input class="form-control form-control-sm" type="email" value={newEmail} onInput={(e) => setNewEmail((e.target as HTMLInputElement).value)} placeholder="user@example.com" required />
            </div>
            <div>
              <label class="form-label small fw-semibold">Permission</label>
              <select class="form-select form-select-sm" value={newPerm} onChange={(e) => setNewPerm((e.target as HTMLSelectElement).value)}>
                {Object.entries(PERM_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <button type="submit" class="btn btn-sm btn-success" disabled={adding}>Add</button>
            {addStatus && <span class="small text-danger">{addStatus}</span>}
          </form>
        </div>
      </div>

      {loading ? <Spinner /> : error ? <ErrorAlert error={error} /> : (
        <div class="table-responsive">
          <table class="table table-sm table-hover">
            <thead>
              <tr>
                <th>Email</th>
                <th>Permission</th>
                <th>Added by</th>
                <th>Added</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {perms.length === 0 ? (
                <tr><td colSpan={5} class="text-center text-muted fst-italic py-3">No team members</td></tr>
              ) : perms.map((p) => (
                <tr key={p.id}>
                  <td>{p.user_email}</td>
                  <td><span class="badge text-bg-secondary">{PERM_LABELS[p.permission] ?? p.permission}</span></td>
                  <td class="small text-muted">{p.granter_email ?? "—"}</td>
                  <td class="mono small">{p.created_at ? p.created_at.substring(0, 10) : "—"}</td>
                  <td>
                    <button class="btn btn-sm btn-outline-danger" onClick={() => void handleRevoke(p.id)}>Revoke</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
