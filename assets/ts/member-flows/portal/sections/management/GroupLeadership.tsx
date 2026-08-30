import { useState } from "preact/hooks";
import {
  groupLeadershipListResponseSchema,
  type GroupLeadershipAssignment,
} from "../../../../../shared/schemas/groups";
import { confirmAction } from "../../../../components/ConfirmDialog";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { RowActions } from "../../../../components/RowActions";
import { Spinner } from "../../../../components/Spinner";
import { useData } from "../../../../hooks/useData";
import { ApiClientError, deleteJson, getJson } from "../../../../shared/api-client";
import { fmt } from "../../ui";
import { GroupLeadershipAssignmentForm } from "./GroupLeadershipAssignmentForm";
import { GROUP_LEADERSHIP_ROLE_LABELS } from "./group-leadership";

export function GroupLeadership({ groupId }: { groupId: string }) {
  const leadership = useData(
    () => getJson(`/api/v1/groups/${encodeURIComponent(groupId)}/leadership`, groupLeadershipListResponseSchema),
    [groupId],
  );
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);

  async function revoke(assignment: GroupLeadershipAssignment): Promise<void> {
    if (assignment.inherited) return;
    const roleLabel = GROUP_LEADERSHIP_ROLE_LABELS[assignment.roleId].toLowerCase();
    if (
      !(await confirmAction({
        title: `Remove ${assignment.userName} as ${roleLabel}?`,
        body: "This removes only this local assignment; leadership inherited from a parent group is not affected.",
        consequences: [`${assignment.userName} immediately loses ${roleLabel} authority in this group`],
        confirmLabel: "Remove from role",
      }))
    )
      return;
    setRevokingId(assignment.userRoleId);
    setMutationError(null);
    try {
      await deleteJson(
        `/api/v1/groups/${encodeURIComponent(groupId)}/leadership/${encodeURIComponent(assignment.userRoleId)}`,
        groupLeadershipListResponseSchema,
      );
      await leadership.reload();
    } catch (cause) {
      setMutationError(
        cause instanceof ApiClientError ? cause.message : "Could not remove this leadership assignment.",
      );
    } finally {
      setRevokingId(null);
    }
  }

  if (leadership.loading && !leadership.data) return <Spinner label="Loading leadership…" />;

  return (
    <div class="card border-0 shadow-sm">
      <div class="card-header bg-white d-flex flex-wrap justify-content-between align-items-center gap-2">
        <span class="fw-semibold">Effective leadership</span>
        <div class="d-flex align-items-center gap-2">
          {leadership.data && (
            <span class="small text-muted">
              {leadership.data.governanceInheritanceMode === "local_only" ? "Local only" : "Inherited by default"}
            </span>
          )}
          <button type="button" class="btn btn-sm btn-success" onClick={() => setShowAddForm(true)}>
            Add leadership
          </button>
        </div>
      </div>
      <div class="card-body d-flex flex-column gap-3">
        <p class="text-muted small mb-0">
          Parent leadership manages descendants by default. Local assignments extend inherited leadership; inherited
          rows must be changed at their source group.
        </p>
        {leadership.error && <ErrorAlert error={leadership.error} />}
        {mutationError && <ErrorAlert error={mutationError} />}
        {leadership.data?.assignments.length === 0 && <p class="text-muted mb-0">No effective leadership.</p>}
        <div class="d-flex flex-column gap-2">
          {leadership.data?.assignments.map((assignment) => (
            <div
              key={assignment.userRoleId}
              class="d-flex flex-wrap align-items-center justify-content-between gap-3 border rounded p-3"
            >
              <div>
                <div class="fw-semibold">
                  {assignment.userName} <span class="text-muted fw-normal">({assignment.email})</span>
                </div>
                <div class="small text-muted">
                  {GROUP_LEADERSHIP_ROLE_LABELS[assignment.roleId]}
                  {assignment.inherited ? ` · inherited from ${assignment.sourceGroup.name}` : " · local"}
                  {assignment.expiresAt ? ` · expires ${fmt(assignment.expiresAt)}` : ""}
                </div>
              </div>
              {!assignment.inherited && (
                <RowActions
                  label={`Actions for ${assignment.userName}`}
                  actions={[
                    {
                      key: "remove",
                      label: revokingId === assignment.userRoleId ? "Removing…" : "Remove",
                      onSelect: () => void revoke(assignment),
                      disabled: revokingId !== null,
                    },
                  ]}
                />
              )}
            </div>
          ))}
        </div>
        {showAddForm && (
          <GroupLeadershipAssignmentForm
            groupId={groupId}
            onAssigned={async () => {
              await leadership.reload();
              setShowAddForm(false);
            }}
            onCancel={() => setShowAddForm(false)}
          />
        )}
      </div>
    </div>
  );
}
