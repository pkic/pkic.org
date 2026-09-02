/**
 * The Leadership tab: who leads this group now, under which title and since
 * when, and the closed terms that came before. Inherited rows are shown but
 * edited at their source group; local rows carry their commands.
 */
import { useState } from "preact/hooks";
import {
  groupLeadershipListResponseSchema,
  type GroupLeadershipAssignment,
  type GroupLeadershipListResponse,
} from "../../../../../shared/schemas/groups";
import { confirmAction } from "../../../../components/ConfirmDialog";
import { EmptyState } from "../../../../components/EmptyState";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { PersonCell } from "../../../../components/PersonCell";
import { RowActions } from "../../../../components/RowActions";
import { Spinner } from "../../../../components/Spinner";
import { Table } from "../../../../components/Table";
import { useData } from "../../../../hooks/useData";
import { ApiClientError, deleteJson, getJson } from "../../../../shared/api-client";
import { GroupLeadershipAssignmentForm } from "./GroupLeadershipAssignmentForm";
import { GroupLeadershipTermForm } from "./GroupLeadershipTermForm";
import { capacityLabel, formatTerm } from "./group-leadership";

function roleAuthority(roleId: GroupLeadershipAssignment["roleId"]): string {
  return roleId === "role-group_lead" ? "Lead role" : "Deputy role";
}

function TermRow({
  assignment,
  busy,
  onEdit,
  onEnd,
}: {
  assignment: GroupLeadershipAssignment;
  busy: boolean;
  onEdit: () => void;
  onEnd?: () => void;
}) {
  const actions = assignment.inherited
    ? []
    : [
        { key: "edit", label: "Edit term", onSelect: onEdit, disabled: busy },
        ...(onEnd ? [{ key: "end", label: "End term now", onSelect: onEnd, disabled: busy }] : []),
      ];
  return (
    <tr>
      <td>
        <PersonCell
          firstName={assignment.userName}
          lastName={null}
          email={assignment.email}
          headshotUrl={assignment.headshotUrl}
        />
      </td>
      <td class="text-nowrap">
        <div class="fw-semibold">{assignment.title}</div>
        <div class="small text-muted">{roleAuthority(assignment.roleId)}</div>
      </td>
      <td>{capacityLabel(assignment)}</td>
      <td class="text-nowrap">{formatTerm(assignment.startsAt, assignment.endsAt)}</td>
      <td>
        {assignment.inherited ? (
          <span class="small text-muted">Inherited from {assignment.sourceGroup.name}</span>
        ) : (
          <span class="small text-muted">This group</span>
        )}
      </td>
      <td class="text-end">
        {actions.length > 0 && <RowActions label={`Actions for ${assignment.userName}`} actions={actions} />}
      </td>
    </tr>
  );
}

export function GroupLeadership({ groupId }: { groupId: string }) {
  const leadership = useData(
    () => getJson(`/api/v1/groups/${encodeURIComponent(groupId)}/leadership`, groupLeadershipListResponseSchema),
    [groupId],
  );
  const [busyId, setBusyId] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editing, setEditing] = useState<GroupLeadershipAssignment | null>(null);

  async function endTerm(assignment: GroupLeadershipAssignment): Promise<void> {
    if (
      !(await confirmAction({
        title: `End ${assignment.userName}'s term as ${assignment.title}?`,
        body: "The term closes today and stays in this group's history.",
        consequences: [`${assignment.userName} immediately loses ${assignment.title.toLowerCase()} authority here`],
        confirmLabel: "End term",
      }))
    )
      return;
    setBusyId(assignment.userRoleId);
    setMutationError(null);
    try {
      await deleteJson(
        `/api/v1/groups/${encodeURIComponent(groupId)}/leadership/${encodeURIComponent(assignment.userRoleId)}`,
        groupLeadershipListResponseSchema,
      );
      await leadership.reload();
    } catch (cause) {
      setMutationError(cause instanceof ApiClientError ? cause.message : "Could not end this leadership term.");
    } finally {
      setBusyId(null);
    }
  }

  if (leadership.loading && !leadership.data) return <Spinner label="Loading leadership…" />;
  const data: GroupLeadershipListResponse | null = leadership.data;
  const titles = data?.titles ?? { lead: "Chair", deputyLead: "Vice Chair" };
  const heads = ["Person", "Title", "Represents", "Term", "Source", { label: "", className: "text-end" }];

  return (
    <div class="d-flex flex-column gap-3">
      <section class="card border-0 shadow-sm" aria-labelledby="group-leadership-heading">
        <div class="card-header bg-white d-flex flex-wrap justify-content-between align-items-center gap-2">
          <div class="d-flex align-items-center gap-2">
            <span id="group-leadership-heading" class="fw-semibold">
              Current leadership
            </span>
            {data && (
              <span class="badge text-bg-light fw-normal">
                {data.governanceInheritanceMode === "local_only" ? "Local only" : "Inherits parent leadership"}
              </span>
            )}
          </div>
          <button
            type="button"
            class="btn btn-sm btn-success"
            onClick={() => {
              setEditing(null);
              setShowAddForm(true);
            }}
          >
            Add leadership
          </button>
        </div>
        <div class="card-body d-flex flex-column gap-3">
          <p class="text-muted small mb-0">
            A {titles.lead.toLowerCase()} holds the lead role and a {titles.deputyLead.toLowerCase()} the deputy role;
            both manage the group. Titles are set per assignment, so co-chairs and secretaries fit without new roles.
            Inherited leadership is changed at its source group.
          </p>
          {leadership.error && <ErrorAlert error={leadership.error} />}
          {mutationError && <ErrorAlert error={mutationError} />}
          {showAddForm && data && (
            <GroupLeadershipAssignmentForm
              groupId={groupId}
              titles={data.titles}
              onAssigned={async () => {
                await leadership.reload();
                setShowAddForm(false);
              }}
              onCancel={() => setShowAddForm(false)}
            />
          )}
          {editing && (
            <GroupLeadershipTermForm
              groupId={groupId}
              assignment={editing}
              titles={titles}
              onSaved={async () => {
                await leadership.reload();
                setEditing(null);
              }}
              onCancel={() => setEditing(null)}
            />
          )}
          {data && (
            <Table
              heads={heads}
              empty={
                <EmptyState
                  title="No leadership yet"
                  body={`Give this group a ${titles.lead.toLowerCase()} from among the people who participate in it.`}
                  action={{ label: "Add leadership", onSelect: () => setShowAddForm(true) }}
                />
              }
            >
              {data.assignments.length > 0 &&
                data.assignments.map((assignment) => (
                  <TermRow
                    key={assignment.userRoleId}
                    assignment={assignment}
                    busy={busyId !== null}
                    onEdit={() => {
                      setShowAddForm(false);
                      setEditing(assignment);
                    }}
                    onEnd={() => void endTerm(assignment)}
                  />
                ))}
            </Table>
          )}
        </div>
      </section>
      {data && data.past.length > 0 && (
        <section class="card border-0 shadow-sm" aria-labelledby="group-past-leadership-heading">
          <div class="card-header bg-white">
            <span id="group-past-leadership-heading" class="fw-semibold">
              Past leadership
            </span>
          </div>
          <div class="card-body">
            <Table heads={heads}>
              {data.past.map((assignment) => (
                <TermRow
                  key={assignment.userRoleId}
                  assignment={assignment}
                  busy={busyId !== null}
                  onEdit={() => {
                    setShowAddForm(false);
                    setEditing(assignment);
                  }}
                />
              ))}
            </Table>
          </div>
        </section>
      )}
    </div>
  );
}
