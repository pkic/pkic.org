import { useEffect, useState } from "preact/hooks";
import { Spinner } from "../../../components/Spinner";
import { api } from "../../api";
import { toast } from "../../ui";
import type { AdminWorkingGroupDetail, AdminWorkingGroupSummary, Role } from "../../types";
import { UserPicker, type PickedUser } from "./UserPicker";

/**
 * PRD §2.4 — "WG management: create/edit working groups, add/remove
 * members directly, assign WG chairs, view WG rosters". Chair assignment
 * reuses the same user_roles mechanism as the "Staff" tab (role
 * `wg_chair`, context_type `working_group`) — that's the actual mechanism
 * §2.2 describes for WG-scoped permissions, not a separate column/endpoint.
 * Create/edit/deactivate and member add/remove hit the admin-only
 * /api/v1/admin/working-groups endpoints (unfiltered by active, full
 * roster with user ids) rather than the public GET /api/v1/working-groups
 * this tab used previously.
 */

function CreateWorkingGroupForm({ onCreated }: { onCreated: () => void }) {
  const [show, setShow] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [mailingListEmail, setMailingListEmail] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: Event) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      await api("/api/v1/admin/working-groups", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
          mailingListEmail: mailingListEmail.trim() || null,
        }),
      });
      toast("Working group created", "success");
      setName("");
      setDescription("");
      setMailingListEmail("");
      setShow(false);
      onCreated();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setSaving(false);
    }
  }

  if (!show) {
    return (
      <button class="btn btn-sm btn-outline-success mb-3" onClick={() => setShow(true)}>
        + Create working group
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} class="border rounded p-3 mb-3 bg-light">
      <div class="row g-2">
        <div class="col-md-4">
          <label class="form-label small fw-semibold">Name</label>
          <input
            class="form-control form-control-sm"
            value={name}
            onInput={(e) => setName((e.target as HTMLInputElement).value)}
            disabled={saving}
            required
          />
        </div>
        <div class="col-md-4">
          <label class="form-label small fw-semibold">Mailing list email</label>
          <input
            type="email"
            class="form-control form-control-sm"
            value={mailingListEmail}
            onInput={(e) => setMailingListEmail((e.target as HTMLInputElement).value)}
            disabled={saving}
          />
        </div>
        <div class="col-md-4">
          <label class="form-label small fw-semibold">Description</label>
          <input
            class="form-control form-control-sm"
            value={description}
            onInput={(e) => setDescription((e.target as HTMLInputElement).value)}
            disabled={saving}
          />
        </div>
      </div>
      <div class="mt-2 d-flex gap-2">
        <button type="submit" class="btn btn-sm btn-success" disabled={saving || !name.trim()}>
          {saving ? "Creating…" : "Create"}
        </button>
        <button type="button" class="btn btn-sm btn-outline-secondary" onClick={() => setShow(false)} disabled={saving}>
          Cancel
        </button>
      </div>
    </form>
  );
}

export function WorkingGroups() {
  const [groups, setGroups] = useState<AdminWorkingGroupSummary[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState<AdminWorkingGroupDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [chairRoleId, setChairRoleId] = useState<string | null>(null);
  const [viceChairRoleId, setViceChairRoleId] = useState<string | null>(null);
  const [chairUser, setChairUser] = useState<PickedUser | null>(null);
  const [viceChairUser, setViceChairUser] = useState<PickedUser | null>(null);
  const [expiresAt, setExpiresAt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [viceSubmitting, setViceSubmitting] = useState(false);
  const [addMemberUser, setAddMemberUser] = useState<PickedUser | null>(null);
  const [addingMember, setAddingMember] = useState(false);
  const [togglingActive, setTogglingActive] = useState(false);

  async function loadGroups(keepSelection = true) {
    try {
      const d = await api<{ workingGroups: AdminWorkingGroupSummary[] }>("/api/v1/admin/working-groups");
      setGroups(d.workingGroups);
      if (!keepSelection || !d.workingGroups.some((g) => g.id === selectedId)) {
        if (d.workingGroups.length) setSelectedId(d.workingGroups[0].id);
      }
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  useEffect(() => {
    void loadGroups(false);
    api<{ roles: Role[] }>("/api/v1/admin/roles")
      .then((d) => {
        setChairRoleId(d.roles.find((r) => r.name === "wg_chair")?.id ?? null);
        setViceChairRoleId(d.roles.find((r) => r.name === "wg_vice_chair")?.id ?? null);
      })
      .catch(() => {});
  }, []);

  async function loadDetail() {
    if (!selectedId) return;
    setLoading(true);
    try {
      const d = await api<{ workingGroup: AdminWorkingGroupDetail }>(`/api/v1/admin/working-groups/${selectedId}`);
      setDetail(d.workingGroup);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadDetail();
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
      await Promise.all([loadDetail(), loadGroups()]);
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAssignViceChair(e: Event) {
    e.preventDefault();
    if (!viceChairUser || !viceChairRoleId || !selectedId) return;
    setViceSubmitting(true);
    try {
      await api(`/api/v1/admin/users/${viceChairUser.id}/roles`, {
        method: "POST",
        body: JSON.stringify({
          roleId: viceChairRoleId,
          contextType: "working_group",
          contextId: selectedId,
          expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined,
        }),
      });
      toast("Vice chair assigned", "success");
      setViceChairUser(null);
      await Promise.all([loadDetail(), loadGroups()]);
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setViceSubmitting(false);
    }
  }

  async function handleRemoveChair(label: "Chair" | "Vice chair", userId: string, userRoleId: string) {
    if (!confirm(`Remove this ${label.toLowerCase()}?`)) return;
    try {
      await api(`/api/v1/admin/users/${userId}/roles/${userRoleId}`, { method: "DELETE" });
      toast(`${label} removed`, "success");
      await Promise.all([loadDetail(), loadGroups()]);
    } catch (err) {
      toast((err as Error).message, "error");
    }
  }

  async function handleAddMember(e: Event) {
    e.preventDefault();
    if (!addMemberUser || !selectedId) return;
    setAddingMember(true);
    try {
      await api(`/api/v1/admin/working-groups/${selectedId}/members`, {
        method: "POST",
        body: JSON.stringify({ userId: addMemberUser.id }),
      });
      toast("Member added", "success");
      setAddMemberUser(null);
      await Promise.all([loadDetail(), loadGroups()]);
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setAddingMember(false);
    }
  }

  async function handleRemoveMember(userId: string, name: string) {
    if (!selectedId) return;
    if (!confirm(`Remove ${name} from this working group?`)) return;
    try {
      await api(`/api/v1/admin/working-groups/${selectedId}/members/${userId}`, { method: "DELETE" });
      toast("Member removed", "success");
      await Promise.all([loadDetail(), loadGroups()]);
    } catch (err) {
      toast((err as Error).message, "error");
    }
  }

  async function handleToggleActive() {
    if (!detail) return;
    const next = !detail.active;
    if (next === false && detail.memberCount > 0) {
      if (!confirm(`Deactivate "${detail.name}"? It still has ${detail.memberCount} member(s) on its roster.`)) return;
    }
    setTogglingActive(true);
    try {
      await api(`/api/v1/admin/working-groups/${detail.id}`, {
        method: "PATCH",
        body: JSON.stringify({ active: next }),
      });
      toast(next ? "Working group reactivated" : "Working group deactivated", "success");
      await Promise.all([loadDetail(), loadGroups()]);
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setTogglingActive(false);
    }
  }

  return (
    <div class="card border-0 shadow-sm mb-3">
      <div class="card-header bg-white fw-semibold">Working group management</div>
      <div class="card-body">
        <CreateWorkingGroupForm onCreated={() => void loadGroups(false)} />

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
                {!g.active ? " (inactive)" : ""}
              </option>
            ))}
          </select>
        </div>

        {loading ? (
          <Spinner />
        ) : detail ? (
          <>
            <div class="d-flex align-items-center gap-2 mb-3">
              <span class={`badge text-bg-${detail.active ? "success" : "secondary"}`}>
                {detail.active ? "Active" : "Inactive"}
              </span>
              <button
                class={`btn btn-sm ${detail.active ? "btn-outline-danger" : "btn-outline-success"}`}
                disabled={togglingActive}
                onClick={handleToggleActive}
              >
                {togglingActive ? "Saving…" : detail.active ? "Deactivate" : "Reactivate"}
              </button>
            </div>

            <div class="row g-2 mb-3">
              <div class="col-md-6">
                <div class="small fw-semibold mb-1">Chair</div>
                {detail.chair ? (
                  <div class="d-flex align-items-center gap-2">
                    <span>
                      {detail.chair.name} <span class="text-muted small">({detail.chair.email})</span>
                    </span>
                    <button
                      class="btn btn-sm btn-outline-danger"
                      onClick={() => void handleRemoveChair("Chair", detail.chair!.userId, detail.chair!.userRoleId)}
                    >
                      Remove
                    </button>
                  </div>
                ) : (
                  <span class="text-muted fst-italic small">Not assigned</span>
                )}
              </div>
              <div class="col-md-6">
                <div class="small fw-semibold mb-1">Vice chair</div>
                {detail.viceChair ? (
                  <div class="d-flex align-items-center gap-2">
                    <span>
                      {detail.viceChair.name} <span class="text-muted small">({detail.viceChair.email})</span>
                    </span>
                    <button
                      class="btn btn-sm btn-outline-danger"
                      onClick={() =>
                        void handleRemoveChair("Vice chair", detail.viceChair!.userId, detail.viceChair!.userRoleId)
                      }
                    >
                      Remove
                    </button>
                  </div>
                ) : (
                  <span class="text-muted fst-italic small">Not assigned</span>
                )}
              </div>
            </div>

            <form onSubmit={handleAssignChair} class="row g-2 align-items-end mb-2">
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

            <form onSubmit={handleAssignViceChair} class="row g-2 align-items-end mb-3">
              <div class="col-md-5">
                <label class="form-label small fw-semibold">Assign vice chair</label>
                <UserPicker value={viceChairUser} onChange={setViceChairUser} disabled={viceSubmitting} />
              </div>
              <div class="col-md-3">
                <button
                  type="submit"
                  class="btn btn-sm btn-success"
                  disabled={viceSubmitting || !viceChairUser || !viceChairRoleId}
                >
                  {viceSubmitting ? "Assigning…" : "Assign as vice chair"}
                </button>
              </div>
              {!viceChairRoleId && (
                <div class="col-12">
                  <span class="small text-danger">The built-in "wg_vice_chair" role was not found.</span>
                </div>
              )}
            </form>

            <form onSubmit={handleAddMember} class="row g-2 align-items-end mb-3">
              <div class="col-md-8">
                <label class="form-label small fw-semibold">Add member</label>
                <UserPicker value={addMemberUser} onChange={setAddMemberUser} disabled={addingMember} />
              </div>
              <div class="col-md-4">
                <button type="submit" class="btn btn-sm btn-success" disabled={addingMember || !addMemberUser}>
                  {addingMember ? "Adding…" : "Add member"}
                </button>
              </div>
            </form>

            <div class="fw-semibold small mb-2">Roster ({detail.members.length})</div>
            <table class="table table-sm table-hover mb-0">
              <thead class="table-dark">
                <tr>
                  <th>Name</th>
                  <th>Organisation</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {detail.members.length === 0 ? (
                  <tr>
                    <td colspan={3} class="text-center text-muted fst-italic py-3">
                      No members
                    </td>
                  </tr>
                ) : (
                  detail.members.map((m) => (
                    <tr key={m.userId}>
                      <td>{m.name}</td>
                      <td class="text-muted small">{m.organizationName ?? "—"}</td>
                      <td class="text-end">
                        <button
                          class="btn btn-sm btn-outline-danger"
                          onClick={() => void handleRemoveMember(m.userId, m.name)}
                        >
                          Remove
                        </button>
                      </td>
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
