import { useCallback, useEffect, useState } from "preact/hooks";
import { Spinner } from "../../../components/Spinner";
import { api } from "../../api";
import { fmt, toast } from "../../ui";
import type { Role, UserRoleAssignment } from "../../types";
import { UserPicker, type PickedUser } from "./UserPicker";
import { ContextPicker, type PickedContext } from "./ContextPicker";

/** PRD §2.4 — "Staff management: assign built-in roles, override individual permissions". */
export function UserRoles() {
  const [user, setUser] = useState<PickedUser | null>(null);
  const [assignments, setAssignments] = useState<UserRoleAssignment[]>([]);
  const [loading, setLoading] = useState(false);
  const [roles, setRoles] = useState<Role[]>([]);
  const [roleId, setRoleId] = useState("");
  const [context, setContext] = useState<PickedContext>({ contextType: null, contextId: null });
  const [expiresAt, setExpiresAt] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api<{ roles: Role[] }>("/api/v1/admin/roles")
      .then((d) => {
        setRoles(d.roles);
        if (d.roles.length) setRoleId(d.roles[0].id);
      })
      .catch(() => {});
  }, []);

  const loadAssignments = useCallback(async (userId: string) => {
    setLoading(true);
    try {
      const data = await api<{ roles: UserRoleAssignment[] }>(`/api/v1/admin/users/${userId}/roles`);
      setAssignments(data.roles);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user) void loadAssignments(user.id);
    else setAssignments([]);
  }, [user, loadAssignments]);

  async function handleAssign(e: Event) {
    e.preventDefault();
    if (!user || !roleId) return;
    if (context.contextType && !context.contextId) {
      toast("Pick a specific event/working group, or clear the context", "error");
      return;
    }
    setSubmitting(true);
    try {
      await api(`/api/v1/admin/users/${user.id}/roles`, {
        method: "POST",
        body: JSON.stringify({
          roleId,
          contextType: context.contextType,
          contextId: context.contextId,
          expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined,
        }),
      });
      toast("Role assigned", "success");
      setContext({ contextType: null, contextId: null });
      setExpiresAt("");
      await loadAssignments(user.id);
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRevoke(assignment: UserRoleAssignment) {
    if (!user) return;
    if (!confirm(`Revoke role "${assignment.roleName}"?`)) return;
    try {
      await api(`/api/v1/admin/users/${user.id}/roles/${assignment.id}`, { method: "DELETE" });
      toast("Role revoked", "success");
      await loadAssignments(user.id);
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  return (
    <div class="card border-0 shadow-sm mb-3">
      <div class="card-header bg-white fw-semibold">Staff management — assign roles</div>
      <div class="card-body">
        <div class="mb-3" style={{ maxWidth: "400px" }}>
          <label class="form-label small fw-semibold">User</label>
          <UserPicker value={user} onChange={setUser} />
        </div>

        {!user ? (
          <p class="text-muted small mb-0">Pick a user to view and manage their role assignments.</p>
        ) : (
          <>
            <form onSubmit={handleAssign} class="row g-2 align-items-end mb-3">
              <div class="col-md-3">
                <label class="form-label small fw-semibold">Role</label>
                <select
                  class="form-select form-select-sm"
                  value={roleId}
                  onChange={(e) => setRoleId((e.target as HTMLSelectElement).value)}
                  disabled={submitting}
                >
                  {roles.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </div>
              <div class="col-md-5">
                <label class="form-label small fw-semibold">Context</label>
                <ContextPicker value={context} onChange={setContext} disabled={submitting} />
              </div>
              <div class="col-md-2">
                <label class="form-label small fw-semibold">Expires (optional)</label>
                <input
                  class="form-control form-control-sm"
                  type="datetime-local"
                  value={expiresAt}
                  onInput={(e) => setExpiresAt((e.target as HTMLInputElement).value)}
                  disabled={submitting}
                />
              </div>
              <div class="col-md-2">
                <button type="submit" class="btn btn-sm btn-success w-100" disabled={submitting || !roleId}>
                  {submitting ? "Assigning…" : "Assign"}
                </button>
              </div>
            </form>

            {loading ? (
              <Spinner />
            ) : (
              <table class="table table-sm table-hover mb-0">
                <thead class="table-dark">
                  <tr>
                    <th>Role</th>
                    <th>Context</th>
                    <th>Expires</th>
                    <th>Granted</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {assignments.length === 0 ? (
                    <tr>
                      <td colspan={5} class="text-center text-muted fst-italic py-3">
                        No roles assigned
                      </td>
                    </tr>
                  ) : (
                    assignments.map((a) => (
                      <tr key={a.id}>
                        <td class="fw-semibold mono">{a.roleName}</td>
                        <td class="small mono">
                          {a.contextType ? `${a.contextType}:${a.contextId}` : <span class="text-muted">Global</span>}
                        </td>
                        <td class="small">{a.expiresAt ? fmt(a.expiresAt) : <span class="text-muted">Never</span>}</td>
                        <td class="small mono">{fmt(a.createdAt)}</td>
                        <td>
                          <button class="btn btn-sm btn-outline-danger" onClick={() => void handleRevoke(a)}>
                            Revoke
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            )}
          </>
        )}
      </div>
    </div>
  );
}
