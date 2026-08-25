import { useEffect, useState } from "preact/hooks";
import {
  GROUP_LEADERSHIP_ROLE_IDS,
  groupLeadershipListResponseSchema,
  groupsListResponseSchema,
  type Group,
  type GroupLeadershipAssignment,
  type GroupLeadershipListResponse,
} from "../../../../shared/schemas/groups";
import { Spinner } from "../../../components/Spinner";
import { api } from "../../api";
import { ApiDataTable } from "../../components/ApiDataTable";
import { fmt, toast } from "../../ui";
import { LeadershipPositions } from "./LeadershipPositions";
import { UserPicker, type PickedUser } from "./UserPicker";

const ROLE_LABELS: Record<(typeof GROUP_LEADERSHIP_ROLE_IDS)[number], string> = {
  "role-group_lead": "Lead",
  "role-group_deputy_lead": "Deputy lead",
};

function AssignmentRow({
  assignment,
  groupId,
  onChanged,
}: {
  assignment: GroupLeadershipAssignment;
  groupId: string;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);

  async function remove(): Promise<void> {
    if (assignment.inherited) return;
    if (!confirm(`Remove ${assignment.userName} as ${ROLE_LABELS[assignment.roleId].toLowerCase()}?`)) return;
    setBusy(true);
    try {
      await api(
        `/api/v1/groups/${encodeURIComponent(groupId)}/leadership/${encodeURIComponent(assignment.userRoleId)}`,
        groupLeadershipListResponseSchema,
        { method: "DELETE" },
      );
      toast("Leadership assignment removed", "success");
      onChanged();
    } catch (error) {
      toast((error as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div class="d-flex align-items-center justify-content-between gap-3 border rounded p-2">
      <div>
        <div class="fw-semibold">
          {assignment.userName} <span class="text-muted fw-normal">({assignment.email})</span>
        </div>
        <div class="small text-muted">
          {ROLE_LABELS[assignment.roleId]}
          {assignment.inherited ? ` · inherited from ${assignment.sourceGroup.name}` : " · local"}
          {assignment.expiresAt ? ` · expires ${fmt(assignment.expiresAt)}` : ""}
        </div>
      </div>
      {!assignment.inherited && (
        <button class="btn btn-sm btn-outline-danger" disabled={busy} onClick={() => void remove()}>
          Remove
        </button>
      )}
    </div>
  );
}

function AssignmentForm({ groupId, onChanged }: { groupId: string; onChanged: () => void }) {
  const [picked, setPicked] = useState<PickedUser | null>(null);
  const [roleId, setRoleId] = useState<(typeof GROUP_LEADERSHIP_ROLE_IDS)[number]>("role-group_lead");
  const [expiresAt, setExpiresAt] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: Event): Promise<void> {
    event.preventDefault();
    if (!picked) return;
    setBusy(true);
    try {
      await api(`/api/v1/groups/${encodeURIComponent(groupId)}/leadership`, groupLeadershipListResponseSchema, {
        method: "POST",
        body: JSON.stringify({
          userId: picked.id,
          roleId,
          expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined,
        }),
      });
      toast("Leadership assignment added", "success");
      setPicked(null);
      setExpiresAt("");
      onChanged();
    } catch (error) {
      toast((error as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form class="border rounded p-3" onSubmit={submit}>
      <div class="row g-2 align-items-end">
        <div class="col-lg-5">
          <label class="form-label small">User</label>
          <UserPicker value={picked} onChange={setPicked} disabled={busy} />
        </div>
        <div class="col-lg-3">
          <label class="form-label small">Role</label>
          <select
            class="form-select form-select-sm"
            value={roleId}
            disabled={busy}
            onChange={(event) =>
              setRoleId((event.target as HTMLSelectElement).value as (typeof GROUP_LEADERSHIP_ROLE_IDS)[number])
            }
          >
            {GROUP_LEADERSHIP_ROLE_IDS.map((id) => (
              <option key={id} value={id}>
                {ROLE_LABELS[id]}
              </option>
            ))}
          </select>
        </div>
        <div class="col-lg-3">
          <label class="form-label small">Expires (optional)</label>
          <input
            class="form-control form-control-sm"
            type="datetime-local"
            value={expiresAt}
            disabled={busy}
            onInput={(event) => setExpiresAt((event.target as HTMLInputElement).value)}
          />
        </div>
        <div class="col-lg-1">
          <button class="btn btn-sm btn-success w-100" type="submit" disabled={busy || !picked}>
            Add
          </button>
        </div>
      </div>
    </form>
  );
}

function GroupLeadershipPanel({ group }: { group: Group }) {
  const [leadership, setLeadership] = useState<GroupLeadershipListResponse | null>(null);
  const [loading, setLoading] = useState(true);

  async function load(): Promise<void> {
    setLoading(true);
    try {
      setLeadership(
        await api(`/api/v1/groups/${encodeURIComponent(group.id)}/leadership`, groupLeadershipListResponseSchema),
      );
    } catch (error) {
      toast((error as Error).message, "error");
      setLeadership(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [group.id]);

  return (
    <div class="card border-0 shadow-sm mb-3">
      <div class="card-header bg-white d-flex align-items-center justify-content-between gap-2">
        <div>
          <span class="fw-semibold">{group.name}</span>
          <span class="badge text-bg-light border ms-2">{group.type.singularLabel}</span>
        </div>
        <span class="small text-muted">
          Governance: {group.governanceInheritanceMode === "local_only" ? "local only" : "inherited"}
        </span>
      </div>
      <div class="card-body d-flex flex-column gap-3">
        {loading ? (
          <Spinner />
        ) : (
          <>
            <div class="d-flex flex-column gap-2">
              {leadership?.assignments.length ? (
                leadership.assignments.map((assignment) => (
                  <AssignmentRow
                    key={assignment.userRoleId}
                    assignment={assignment}
                    groupId={group.id}
                    onChanged={() => void load()}
                  />
                ))
              ) : (
                <p class="text-muted mb-0">No effective leadership assignments.</p>
              )}
            </div>
            <AssignmentForm groupId={group.id} onChanged={() => void load()} />
          </>
        )}
      </div>
    </div>
  );
}

export function Leadership() {
  const [selectedGroup, setSelectedGroup] = useState<Group | null>(null);

  return (
    <div>
      <LeadershipPositions body="board" label="Board of Directors" />
      <LeadershipPositions body="executive_council" label="Executive Council" />

      {selectedGroup && <GroupLeadershipPanel key={selectedGroup.id} group={selectedGroup} />}

      <div class="card border-0 shadow-sm">
        <div class="card-header bg-white fw-semibold">Group leadership</div>
        <div class="card-body">
          <p class="small text-muted">
            Select any group type. Parent leadership is shown as inherited unless the group uses local-only governance.
          </p>
          <ApiDataTable
            endpoint="/api/v1/groups"
            responseSchema={groupsListResponseSchema}
            resolve={(response) => response.groups}
            resolvePage={(response) => response.page}
            paginate
            initialPageSize={25}
            initialSort="name"
            searchPlaceholder="Search groups…"
            rowKey={(group) => group.id}
            empty="No groups"
            columns={[
              {
                header: "Group",
                cell: (group) => (
                  <div>
                    <span class="fw-semibold">{group.name}</span>
                    {!group.active && <span class="badge text-bg-secondary ms-2">Inactive</span>}
                    <div class="small text-muted">
                      {group.type.singularLabel}
                      {group.parentGroup ? ` · ${group.parentGroup.name}` : ""}
                    </div>
                  </div>
                ),
                sort: { asc: "name", desc: "-name" },
              },
              {
                header: "Participants",
                cell: (group) => group.participantCount,
                sort: { asc: "participant_count", desc: "-participant_count" },
              },
              {
                header: "",
                cell: (group) => (
                  <button class="btn btn-sm btn-outline-primary" onClick={() => setSelectedGroup(group)}>
                    Manage
                  </button>
                ),
                className: "text-end",
              },
            ]}
          />
        </div>
      </div>
    </div>
  );
}
