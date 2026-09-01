import { useState } from "preact/hooks";
import {
  groupLeadershipListResponseSchema,
  type GroupLeadershipAssignment,
} from "../../../../../shared/schemas/groups";
import { confirmAction } from "../../../../components/ConfirmDialog";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { Spinner } from "../../../../components/Spinner";
import { Button } from "../../../../ui/Button";
import { DataTable, type DataTableColumn } from "../../../../ui/DataTable";
import { EmptyState } from "../../../../ui/EmptyState";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
import { PersonCell } from "../../../../ui/PersonCell";
import { RowActions } from "../../../../ui/RowActions";
import { useData } from "../../../../hooks/useData";
import { ApiClientError, deleteJson, getJson } from "../../../../shared/api-client";
import { fmt } from "../../ui";
import { GroupLeadershipAssignmentForm } from "./GroupLeadershipAssignmentForm";
import { GROUP_LEADERSHIP_ROLE_LABELS } from "./group-leadership";

/**
 * Where an assignment comes from, in words.
 *
 * This used to be a run-on line of separators — the role, then "· inherited
 * from X", then "· expires …" — so the one fact that decides whether a row can
 * be removed sat mid-sentence in muted small text. It is a column of its own
 * now, and it says "Local" or names the source group, so the distinction never
 * rests on the row merely lacking an actions menu.
 */
function sourceLabel(assignment: GroupLeadershipAssignment): string {
  return assignment.inherited ? `Inherited from ${assignment.sourceGroup.name}` : "Local";
}

function leadershipColumns(
  revokingId: string | null,
  onRevoke: (assignment: GroupLeadershipAssignment) => void,
): ReadonlyArray<DataTableColumn<GroupLeadershipAssignment>> {
  return [
    {
      id: "person",
      header: "Person",
      cell: (assignment) => <PersonCell name={assignment.userName} email={assignment.email} size="sm" />,
    },
    { id: "role", header: "Role", cell: (assignment) => GROUP_LEADERSHIP_ROLE_LABELS[assignment.roleId] },
    { id: "source", header: "Source", cell: sourceLabel },
    {
      id: "expires",
      header: "Expires",
      cellClass: "pk-nowrap",
      cell: (assignment) => (assignment.expiresAt ? fmt(assignment.expiresAt) : "—"),
    },
    {
      id: "actions",
      header: "Actions",
      headerHidden: true,
      align: "end",
      // Inherited leadership has no local assignment to remove, so its row
      // carries no menu at all rather than a menu that refuses.
      cell: (assignment) =>
        assignment.inherited ? null : (
          <RowActions
            subject={assignment.userName}
            actions={[
              {
                id: "remove",
                label: revokingId === assignment.userRoleId ? "Removing…" : "Remove",
                onSelect: () => onRevoke(assignment),
                disabled: revokingId !== null,
              },
            ]}
          />
        ),
    },
  ];
}

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
    // The panel names itself: a group workspace stacks several of these, and
    // an unnamed <section> is announced as nothing at all.
    <Panel class="pk" aria-label="Effective leadership">
      <PanelHeader title="Effective leadership">
        {leadership.data && (
          <span class="pk-small">
            {leadership.data.governanceInheritanceMode === "local_only" ? "Local only" : "Inherited by default"}
          </span>
        )}
        <Button size="sm" variant="primary" onClick={() => setShowAddForm(true)}>
          Add leadership
        </Button>
      </PanelHeader>
      <PanelBody class="pk-stack">
        <p class="pk-muted pk-small">
          Parent leadership manages descendants by default. Local assignments extend inherited leadership; inherited
          rows must be changed at their source group.
        </p>
        {mutationError && <ErrorAlert error={mutationError} />}
        {/* A failed load replaces the table rather than sitting above an empty
            one: "No effective leadership" is a claim about the group, and the
            surface does not know that when the request did not arrive. */}
        {leadership.error ? (
          <ErrorAlert error={leadership.error} />
        ) : (
          <DataTable
            caption="Effective leadership of this group"
            columns={leadershipColumns(revokingId, (assignment) => void revoke(assignment))}
            rows={leadership.data?.assignments ?? []}
            rowKey={(assignment) => assignment.userRoleId}
            loading={leadership.loading}
            empty={
              <EmptyState
                title="No effective leadership."
                body="Nobody leads this group yet, and no parent group's leadership reaches it."
              />
            }
          />
        )}
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
      </PanelBody>
    </Panel>
  );
}
