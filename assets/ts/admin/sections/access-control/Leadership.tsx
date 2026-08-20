import { useEffect, useState } from "preact/hooks";
import { Spinner } from "../../../components/Spinner";
import { api } from "../../api";
import { fmt, toast } from "../../ui";
import type { AdminWorkingGroupSummary, Role, RoleAssignment } from "../../types";
import { UserPicker, type PickedUser } from "./UserPicker";
import { LeadershipPositions } from "./LeadershipPositions";

/**
 * "Create a new tab under the Access Control for chairs to set the chairs
 * for each working group and the forum" — one screen for both the
 * PKIC-wide (forum) chair/vice-chair (role-forum_chair/role-forum_vice_chair,
 * global — contextType/contextId both null, migration 0040) and every
 * working group's chair/vice-chair (role-wg_chair/role-wg_vice_chair,
 * context_type='working_group'). All of it is the same user_roles
 * assign/revoke mechanism the "Staff" and "Working Groups" tabs already use
 * — this tab just composes it per-role-per-context in one place instead of
 * requiring staff to already know which user to look up.
 *
 * Renamed from "Chairs" to "Leadership" when Board of Directors and
 * Executive Council roster management (migration 0049) were added here —
 * "Chairs" no longer described the page once it covered the full
 * leadership picture, not just chair/vice-chair designations.
 */

interface HolderInfo {
  userRoleId: string;
  userId: string;
  name: string;
  email: string;
  expiresAt: string | null;
}

/** ISO datetime -> the local "YYYY-MM-DDTHH:mm" value a datetime-local input expects. */
function toDatetimeLocal(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function ChairSlot({
  label,
  roleId,
  roleMissingLabel,
  contextType,
  contextId,
  current,
  onChanged,
}: {
  label: string;
  roleId: string | null;
  roleMissingLabel: string;
  contextType: "working_group" | null;
  contextId: string | null;
  current: HolderInfo | null;
  onChanged: () => void;
}) {
  const [picked, setPicked] = useState<PickedUser | null>(null);
  const [expiresAt, setExpiresAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [editingExpiry, setEditingExpiry] = useState(false);
  const [editExpiresAt, setEditExpiresAt] = useState("");

  function startEditExpiry() {
    setEditExpiresAt(current?.expiresAt ? toDatetimeLocal(current.expiresAt) : "");
    setEditingExpiry(true);
  }

  async function saveExpiry(e: Event) {
    e.preventDefault();
    if (!current) return;
    setBusy(true);
    try {
      await api(`/api/v1/admin/users/${current.userId}/roles/${current.userRoleId}`, {
        method: "PATCH",
        body: JSON.stringify({
          expiresAt: editExpiresAt ? new Date(editExpiresAt).toISOString() : null,
        }),
      });
      toast(`${label} expiry updated`, "success");
      setEditingExpiry(false);
      onChanged();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function assign(e: Event) {
    e.preventDefault();
    if (!picked || !roleId) return;
    setBusy(true);
    try {
      await api(`/api/v1/admin/users/${picked.id}/roles`, {
        method: "POST",
        body: JSON.stringify({
          roleId,
          contextType,
          contextId,
          expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined,
        }),
      });
      toast(`${label} assigned`, "success");
      setPicked(null);
      setExpiresAt("");
      onChanged();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!current) return;
    if (!confirm(`Remove ${current.name} as ${label.toLowerCase()}?`)) return;
    setBusy(true);
    try {
      await api(`/api/v1/admin/users/${current.userId}/roles/${current.userRoleId}`, { method: "DELETE" });
      toast(`${label} removed`, "success");
      onChanged();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div class="d-flex align-items-center gap-2 flex-wrap">
      <span class="small fw-semibold adm-leadership-slot-label">{label}</span>
      {current ? (
        <>
          <span>
            {current.name} <span class="text-muted small">({current.email})</span>
          </span>
          {editingExpiry ? (
            <form onSubmit={saveExpiry} class="d-flex gap-2 align-items-center flex-wrap">
              <input
                class="form-control form-control-sm adm-leadership-date"
                type="datetime-local"
                title="Term expires (leave blank for no expiry)"
                placeholder="Term expires (optional)"
                value={editExpiresAt}
                onInput={(e) => setEditExpiresAt((e.target as HTMLInputElement).value)}
                disabled={busy}
              />
              <button type="submit" class="btn btn-sm btn-success" disabled={busy}>
                Save
              </button>
              <button
                type="button"
                class="btn btn-sm btn-outline-secondary"
                disabled={busy}
                onClick={() => setEditingExpiry(false)}
              >
                Cancel
              </button>
            </form>
          ) : (
            <>
              <span class="text-muted small">
                {current.expiresAt ? `Expires ${fmt(current.expiresAt)}` : "No expiry set"}
              </span>
              <button class="btn btn-sm btn-outline-secondary" disabled={busy} onClick={startEditExpiry}>
                Edit expiry
              </button>
              <button class="btn btn-sm btn-outline-danger" disabled={busy} onClick={() => void remove()}>
                Remove
              </button>
            </>
          )}
        </>
      ) : !roleId ? (
        <span class="small text-danger">{roleMissingLabel}</span>
      ) : (
        <form onSubmit={assign} class="d-flex gap-2 align-items-center flex-wrap">
          <div class="adm-leadership-user">
            <UserPicker value={picked} onChange={setPicked} disabled={busy} />
          </div>
          <input
            class="form-control form-control-sm adm-leadership-date"
            type="datetime-local"
            title="Term expires (optional)"
            placeholder="Term expires (optional)"
            value={expiresAt}
            onInput={(e) => setExpiresAt((e.target as HTMLInputElement).value)}
            disabled={busy}
          />
          <button type="submit" class="btn btn-sm btn-success" disabled={busy || !picked}>
            Assign
          </button>
        </form>
      )}
    </div>
  );
}

export function Leadership() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [groups, setGroups] = useState<AdminWorkingGroupSummary[]>([]);
  const [forumChair, setForumChair] = useState<RoleAssignment | null>(null);
  const [forumViceChair, setForumViceChair] = useState<RoleAssignment | null>(null);
  const [loading, setLoading] = useState(true);

  function roleId(name: string): string | null {
    return roles.find((r) => r.name === name)?.id ?? null;
  }

  async function load() {
    setLoading(true);
    try {
      const rolesData = await api<{ roles: Role[] }>("/api/v1/admin/roles");
      setRoles(rolesData.roles);

      const forumChairRoleId = rolesData.roles.find((r) => r.name === "forum_chair")?.id;
      const forumViceChairRoleId = rolesData.roles.find((r) => r.name === "forum_vice_chair")?.id;

      const [groupsData, forumChairAssignments, forumViceChairAssignments] = await Promise.all([
        api<{ workingGroups: AdminWorkingGroupSummary[] }>("/api/v1/admin/working-groups"),
        forumChairRoleId
          ? api<{ assignments: RoleAssignment[] }>(`/api/v1/admin/roles/${forumChairRoleId}/assignments`)
          : Promise.resolve({ assignments: [] as RoleAssignment[] }),
        forumViceChairRoleId
          ? api<{ assignments: RoleAssignment[] }>(`/api/v1/admin/roles/${forumViceChairRoleId}/assignments`)
          : Promise.resolve({ assignments: [] as RoleAssignment[] }),
      ]);

      setGroups(groupsData.workingGroups);
      setForumChair(forumChairAssignments.assignments[0] ?? null);
      setForumViceChair(forumViceChairAssignments.assignments[0] ?? null);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  if (loading) return <Spinner />;

  return (
    <div>
      <div class="card border-0 shadow-sm mb-3">
        <div class="card-header bg-white fw-semibold">Forum</div>
        <div class="card-body d-flex flex-column gap-2">
          <ChairSlot
            label="Chair"
            roleId={roleId("forum_chair")}
            roleMissingLabel='The built-in "forum_chair" role was not found.'
            contextType={null}
            contextId={null}
            current={forumChair}
            onChanged={() => void load()}
          />
          <ChairSlot
            label="Vice chair"
            roleId={roleId("forum_vice_chair")}
            roleMissingLabel='The built-in "forum_vice_chair" role was not found.'
            contextType={null}
            contextId={null}
            current={forumViceChair}
            onChanged={() => void load()}
          />
        </div>
      </div>

      <LeadershipPositions body="board" label="Board of Directors" />
      <LeadershipPositions body="executive_council" label="Executive Council" />

      <div class="card border-0 shadow-sm">
        <div class="card-header bg-white fw-semibold">Working groups</div>
        <div class="card-body d-flex flex-column gap-3">
          {groups.length === 0 && <span class="text-muted fst-italic small">No working groups</span>}
          {groups.map((g) => (
            <div key={g.id} class="border rounded p-2">
              <div class="fw-semibold small mb-2">
                {g.name}
                {!g.active && <span class="badge text-bg-secondary ms-2">Inactive</span>}
              </div>
              <div class="d-flex flex-column gap-2">
                <ChairSlot
                  label="Chair"
                  roleId={roleId("wg_chair")}
                  roleMissingLabel='The built-in "wg_chair" role was not found.'
                  contextType="working_group"
                  contextId={g.id}
                  current={g.chair}
                  onChanged={() => void load()}
                />
                <ChairSlot
                  label="Vice chair"
                  roleId={roleId("wg_vice_chair")}
                  roleMissingLabel='The built-in "wg_vice_chair" role was not found.'
                  contextType="working_group"
                  contextId={g.id}
                  current={g.viceChair}
                  onChanged={() => void load()}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
