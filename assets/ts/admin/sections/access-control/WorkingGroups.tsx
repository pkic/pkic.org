import { useEffect, useState } from "preact/hooks";
import { useHashLocation } from "wouter/use-hash-location";
import { Spinner } from "../../../components/Spinner";
import { api } from "../../api";
import { fmt, toast } from "../../ui";
import type { AdminWorkingGroupDetail, AdminWorkingGroupMember, AdminWorkingGroupSummary } from "../../types";
import { UserPicker, type PickedUser } from "./UserPicker";

type MemberSortKey = "name" | "organizationName" | "memberCategory";
type SortDir = "asc" | "desc";

function memberSortValue(m: AdminWorkingGroupMember, key: MemberSortKey): string | null {
  switch (key) {
    case "name":
      return m.name;
    case "organizationName":
      return m.organizationName ?? null;
    case "memberCategory":
      return m.memberCategory ?? null;
  }
}

// Nulls always sort last, regardless of direction.
function compareMemberSort(
  a: AdminWorkingGroupMember,
  b: AdminWorkingGroupMember,
  key: MemberSortKey,
  dir: SortDir,
): number {
  const av = memberSortValue(a, key);
  const bv = memberSortValue(b, key);
  if (av == null && bv == null) return 0;
  if (av == null) return 1;
  if (bv == null) return -1;
  const cmp = av.localeCompare(bv);
  return dir === "asc" ? cmp : -cmp;
}

/**
 * PRD §2.4 — "WG management: create/edit working groups, add/remove
 * members directly, view WG rosters". Chair/vice-chair assignment (with
 * term expiry) moved to the dedicated "Chairs" section — this tab only
 * displays the current holders and their term expiry read-only, to avoid
 * two places editing the same user_roles rows. Create/edit/deactivate and
 * member add/remove hit the admin-only /api/v1/admin/working-groups
 * endpoints (unfiltered by active, full roster with user ids) rather than
 * the public GET /api/v1/working-groups this tab used previously.
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
  const [, navigate] = useHashLocation();
  const [groups, setGroups] = useState<AdminWorkingGroupSummary[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState<AdminWorkingGroupDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [addMemberUser, setAddMemberUser] = useState<PickedUser | null>(null);
  const [addingMember, setAddingMember] = useState(false);
  const [togglingActive, setTogglingActive] = useState(false);
  const [memberSortKey, setMemberSortKey] = useState<MemberSortKey | null>(null);
  const [memberSortDir, setMemberSortDir] = useState<SortDir>("asc");
  const [syncing, setSyncing] = useState(false);

  function toggleMemberSort(key: MemberSortKey) {
    if (memberSortKey === key) {
      setMemberSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setMemberSortKey(key);
      setMemberSortDir("asc");
    }
  }

  function memberSortTh(label: string, key: MemberSortKey) {
    const active = memberSortKey === key;
    return (
      <th>
        <button
          type="button"
          class={`tbl-sort-btn${active ? " is-active" : ""}`}
          onClick={() => toggleMemberSort(key)}
          aria-sort={active ? (memberSortDir === "asc" ? "ascending" : "descending") : "none"}
        >
          <span>{label}</span>
          <span aria-hidden="true" class="tbl-sort-indicator">
            {active ? (memberSortDir === "asc" ? "▲" : "▼") : "↕"}
          </span>
        </button>
      </th>
    );
  }

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

  /**
   * "Add a sync button to the working groups to force a google group sync
   * after any changes have been made to the members of the working group"
   * (2026-07-30 testing feedback). Reuses the same on-demand drain endpoint
   * the Mailing Lists tab's "Sync now" button already calls — a working
   * group's roster is synced to Google Groups via its mailing_list_email,
   * so there's nothing WG-specific to scope the drain to; it just processes
   * whatever is pending, same as the mailing-lists button.
   */
  async function handleSyncNow() {
    setSyncing(true);
    try {
      const res = await api<{ processed: number; succeeded: number; failed: number; skippedUnconfigured: boolean }>(
        "/api/v1/admin/mailing-lists/sync",
        { method: "POST" },
      );
      if (res.skippedUnconfigured) {
        toast("Google Groups sync isn't configured in this environment", "error");
      } else if (res.processed === 0) {
        toast("Nothing pending to sync", "success");
      } else {
        toast(
          `Synced ${res.processed}: ${res.succeeded} succeeded${res.failed ? `, ${res.failed} failed` : ""}`,
          res.failed > 0 ? "error" : "success",
        );
      }
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setSyncing(false);
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
      <div class="card-header bg-white fw-semibold d-flex justify-content-between align-items-center">
        <span>Working group management</span>
        <button type="button" class="btn btn-outline-success btn-sm" disabled={syncing} onClick={handleSyncNow}>
          {syncing ? "Syncing…" : "↺ Sync Google Group now"}
        </button>
      </div>
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
                  <div>
                    <span>
                      {detail.chair.name} <span class="text-muted small">({detail.chair.email})</span>
                    </span>
                    <div class="text-muted small">
                      {detail.chair.expiresAt ? `Term expires ${fmt(detail.chair.expiresAt)}` : "No expiry set"}
                    </div>
                  </div>
                ) : (
                  <span class="text-muted fst-italic small">Not assigned</span>
                )}
              </div>
              <div class="col-md-6">
                <div class="small fw-semibold mb-1">Vice chair</div>
                {detail.viceChair ? (
                  <div>
                    <span>
                      {detail.viceChair.name} <span class="text-muted small">({detail.viceChair.email})</span>
                    </span>
                    <div class="text-muted small">
                      {detail.viceChair.expiresAt ? `Term expires ${fmt(detail.viceChair.expiresAt)}` : "No expiry set"}
                    </div>
                  </div>
                ) : (
                  <span class="text-muted fst-italic small">Not assigned</span>
                )}
              </div>
              <div class="col-12">
                <span class="small text-muted fst-italic">
                  Chair and vice chair are assigned from the "Chairs" section.
                </span>
              </div>
            </div>

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
                  {memberSortTh("Name", "name")}
                  {memberSortTh("Organisation", "organizationName")}
                  {memberSortTh("Category", "memberCategory")}
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {detail.members.length === 0 ? (
                  <tr>
                    <td colspan={4} class="text-center text-muted fst-italic py-3">
                      No members
                    </td>
                  </tr>
                ) : (
                  (memberSortKey
                    ? detail.members.slice().sort((a, b) => compareMemberSort(a, b, memberSortKey, memberSortDir))
                    : detail.members
                  ).map((m) => (
                    <tr key={m.userId}>
                      <td>
                        <button
                          type="button"
                          class="btn btn-link p-0"
                          onClick={() => navigate(`/users/detail/${m.userId}`)}
                          title="View user details"
                        >
                          {m.name}
                        </button>
                      </td>
                      <td class="text-muted small">{m.organizationName ?? "—"}</td>
                      <td class="text-muted small mono">{m.memberCategory ?? "—"}</td>
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
