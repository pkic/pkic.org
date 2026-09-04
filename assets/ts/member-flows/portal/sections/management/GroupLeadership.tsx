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
import { GroupLeadershipAssignmentForm } from "./GroupLeadershipAssignmentForm";
import { GroupLeadershipTermForm } from "./GroupLeadershipTermForm";
import { capacityLabel, formatTerm } from "./group-leadership";

function roleAuthority(roleId: GroupLeadershipAssignment["roleId"]): string {
  return roleId === "role-group_lead" ? "Lead role" : "Deputy role";
}

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
  busyId: string | null,
  onEdit: (assignment: GroupLeadershipAssignment) => void,
  onEnd?: (assignment: GroupLeadershipAssignment) => void,
): ReadonlyArray<DataTableColumn<GroupLeadershipAssignment>> {
  return [
    {
      id: "person",
      header: "Person",
      // The design system's table gives slack to no column on its own; the
      // person is the row's subject, so a wide screen's slack lands here.
      width: "primary",
      cell: (assignment) => <PersonCell name={assignment.userName} email={assignment.email} size="sm" />,
    },
    {
      // The title is what this person is called here; the role underneath is
      // the authority it carries, which is what the group type configures.
      id: "title",
      header: "Title",
      cell: (assignment) => (
        <>
          <div class="pk-strong">{assignment.title}</div>
          <div class="pk-small pk-muted">{roleAuthority(assignment.roleId)}</div>
        </>
      ),
    },
    { id: "represents", header: "Represents", cell: capacityLabel },
    {
      // A term has a bounded length; the column hugs it instead of wearing
      // `pk-nowrap` while still claiming slack.
      id: "term",
      header: "Term",
      width: "fit",
      cell: (assignment) => formatTerm(assignment.startsAt, assignment.endsAt),
    },
    { id: "source", header: "Source", cell: sourceLabel },
    {
      id: "actions",
      header: "Actions",
      headerHidden: true,
      align: "end",
      // Inherited leadership has no local term to edit or end, so its row
      // carries no menu at all rather than a menu that refuses.
      cell: (assignment) =>
        assignment.inherited ? null : (
          <RowActions
            subject={assignment.userName}
            actions={[
              { id: "edit", label: "Edit term", onSelect: () => onEdit(assignment), disabled: busyId !== null },
              ...(onEnd
                ? [
                    {
                      id: "end",
                      label: busyId === assignment.userRoleId ? "Ending…" : "End term now",
                      onSelect: () => onEnd(assignment),
                      disabled: busyId !== null,
                    },
                  ]
                : []),
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

  return (
    <div class="pk pk-stack">
      {/* The panel names itself: a group workspace stacks several of these,
          and an unnamed <section> is announced as nothing at all. */}
      <Panel aria-label="Leadership">
        <PanelHeader title="Leadership">
          {data && (
            <span class="pk-small pk-muted">
              {data.governanceInheritanceMode === "local_only" ? "Local only" : "Inherits parent leadership"}
            </span>
          )}
          <Button
            size="sm"
            variant="primary"
            onClick={() => {
              setEditing(null);
              setShowAddForm(true);
            }}
          >
            Add leadership
          </Button>
        </PanelHeader>
        <PanelBody class="pk-stack">
          <p class="pk-muted pk-small">
            A {titles.lead.toLowerCase()} holds the lead role and a {titles.deputyLead.toLowerCase()} the deputy role;
            both manage the group. Titles are set per assignment, so co-chairs and secretaries fit without new roles.
            Inherited leadership is changed at its source group.
          </p>
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
          {/* A failed load replaces the table rather than sitting above an
              empty one: "No leadership yet" is a claim about the group, and
              the surface does not know that when the request did not arrive. */}
          {leadership.error ? (
            <ErrorAlert error={leadership.error} />
          ) : (
            <DataTable
              caption="Current leadership of this group"
              columns={leadershipColumns(
                busyId,
                (assignment) => {
                  setShowAddForm(false);
                  setEditing(assignment);
                },
                (assignment) => void endTerm(assignment),
              )}
              rows={data?.assignments ?? []}
              rowKey={(assignment) => assignment.userRoleId}
              loading={leadership.loading}
              empty={
                <EmptyState
                  title="No leadership yet"
                  body={`Give this group a ${titles.lead.toLowerCase()} from among the people who participate in it.`}
                >
                  <Button size="sm" variant="primary" onClick={() => setShowAddForm(true)}>
                    Add leadership
                  </Button>
                </EmptyState>
              }
            />
          )}
        </PanelBody>
      </Panel>
      {data && data.past.length > 0 && (
        <Panel aria-label="Past leadership">
          <PanelHeader title="Past leadership" />
          <PanelBody>
            <DataTable
              caption="Closed leadership terms of this group"
              columns={leadershipColumns(busyId, (assignment) => {
                setShowAddForm(false);
                setEditing(assignment);
              })}
              rows={data.past}
              rowKey={(assignment) => assignment.userRoleId}
            />
          </PanelBody>
        </Panel>
      )}
    </div>
  );
}
