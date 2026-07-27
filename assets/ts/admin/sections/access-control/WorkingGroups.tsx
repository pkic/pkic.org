import { useEffect, useState } from "preact/hooks";
import { Spinner } from "../../../components/Spinner";
import { api } from "../../api";
import { toast } from "../../ui";
import type { Role, WorkingGroupDetail, WorkingGroupSummary } from "../../types";
import { UserPicker, type PickedUser } from "./UserPicker";

/**
 * PRD §2.4 — "WG management: assign WG chairs, view WG rosters". Chair
 * assignment reuses the same user_roles mechanism as the "Staff" tab (role
 * `wg_chair`, context_type `working_group`) — that's the actual mechanism
 * §2.2 describes for WG-scoped permissions, not a separate column/endpoint.
 */
export function WorkingGroups() {
  const [groups, setGroups] = useState<WorkingGroupSummary[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState<WorkingGroupDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [chairRoleId, setChairRoleId] = useState<string | null>(null);
  const [chairUser, setChairUser] = useState<PickedUser | null>(null);
  const [expiresAt, setExpiresAt] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api<{ workingGroups: WorkingGroupSummary[] }>("/api/v1/working-groups")
      .then((d) => {
        setGroups(d.workingGroups);
        if (d.workingGroups.length) setSelectedId(d.workingGroups[0].id);
      })
      .catch(() => {});
    api<{ roles: Role[] }>("/api/v1/admin/roles")
      .then((d) => setChairRoleId(d.roles.find((r) => r.name === "wg_chair")?.id ?? null))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    setLoading(true);
    api<WorkingGroupDetail>(`/api/v1/working-groups/${selectedId}`)
      .then(setDetail)
      .catch((e) => toast((e as Error).message, "error"))
      .finally(() => setLoading(false));
  }, [selectedId]);

  async function handleAssignChair(e: Event) {
    e.preventDefault();
    if (!chairUser || !chairRoleId || !selectedId) return;
    setSubmitting(true);
    try {
      await api(`/api/v1/admin/users/${chairUser.id}/roles`, {
        method: "POST",
        body: JSON.stringify({
          roleId: chairRoleId,
          contextType: "working_group",
          contextId: selectedId,
          expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined,
        }),
      });
      toast("Chair assigned", "success");
      setChairUser(null);
      setExpiresAt("");
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div class="card border-0 shadow-sm mb-3">
      <div class="card-header bg-white fw-semibold">Working group management</div>
      <div class="card-body">
        <div class="mb-3" style={{ maxWidth: "320px" }}>
          <label class="form-label small fw-semibold">Working group</label>
          <select
            class="form-select form-select-sm"
            value={selectedId}
            onChange={(e) => setSelectedId((e.target as HTMLSelectElement).value)}
          >
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </div>

        {loading ? (
          <Spinner />
        ) : detail ? (
          <>
            <form onSubmit={handleAssignChair} class="row g-2 align-items-end mb-3">
              <div class="col-md-5">
                <label class="form-label small fw-semibold">Assign chair</label>
                <UserPicker value={chairUser} onChange={setChairUser} disabled={submitting} />
              </div>
              <div class="col-md-3">
                <label class="form-label small fw-semibold">Expires (optional)</label>
                <input
                  class="form-control form-control-sm"
                  type="datetime-local"
                  value={expiresAt}
                  onInput={(e) => setExpiresAt((e.target as HTMLInputElement).value)}
                  disabled={submitting}
                />
              </div>
              <div class="col-md-3">
                <button
                  type="submit"
                  class="btn btn-sm btn-success"
                  disabled={submitting || !chairUser || !chairRoleId}
                >
                  {submitting ? "Assigning…" : "Assign as chair"}
                </button>
              </div>
              {!chairRoleId && (
                <div class="col-12">
                  <span class="small text-danger">The built-in "wg_chair" role was not found.</span>
                </div>
              )}
            </form>

            <div class="fw-semibold small mb-2">Roster ({detail.members.length})</div>
            <table class="table table-sm table-hover mb-0">
              <thead class="table-dark">
                <tr>
                  <th>Name</th>
                  <th>Organisation</th>
                </tr>
              </thead>
              <tbody>
                {detail.members.length === 0 ? (
                  <tr>
                    <td colspan={2} class="text-center text-muted fst-italic py-3">
                      No members
                    </td>
                  </tr>
                ) : (
                  detail.members.map((m, i) => (
                    <tr key={i}>
                      <td>{m.name}</td>
                      <td class="text-muted small">{m.organizationName ?? "—"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </>
        ) : null}
      </div>
    </div>
  );
}
