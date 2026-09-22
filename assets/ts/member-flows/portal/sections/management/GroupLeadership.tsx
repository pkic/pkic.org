/**
 * The Leadership tab: who leads this group now, under which title and since
 * when, and the closed terms that came before. Inherited rows are shown but
 * edited at their source group; local rows carry their commands.
 */
import { useEffect, useRef, useState } from "preact/hooks";
import {
  groupLeadershipListResponseSchema,
  type GroupLeadershipAssignment,
  type GroupLeadershipListResponse,
} from "../../../../../shared/schemas/groups";
import { confirmAction } from "../../../../components/ConfirmDialog";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { Spinner } from "../../../../components/Spinner";
import { usePortalHashLocation } from "../../hash-location";
import { ApiDataTable, type ApiTableActions } from "../../../../components/ApiDataTable";
import type { Column } from "../../../../components/Table";
import { EmptyState } from "../../../../ui/EmptyState";
import { Select } from "../../../../ui/TextControl";
import { Panel, PanelHeader } from "../../../../ui/Panel";
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
): Column<GroupLeadershipAssignment>[] {
  return [
    {
      header: "Person",
      sort: { asc: "person", desc: "-person" },
      // The design system's table gives slack to no column on its own; the
      // person is the row's subject, so a wide screen's slack lands here.
      width: "primary",
      cell: (assignment) => <PersonCell name={assignment.userName} email={assignment.email} size="sm" />,
    },
    {
      // The title is what this person is called here; the role underneath is
      // the authority it carries, which is what the group type configures.
      header: "Title",
      sort: { asc: "title", desc: "-title" },
      cell: (assignment) => (
        <>
          <div class="pk-strong">{assignment.title}</div>
          <div class="pk-small pk-muted">{roleAuthority(assignment.roleId)}</div>
        </>
      ),
    },
    { header: "Represents", cell: capacityLabel },
    {
      // A term has a bounded length; the column hugs it instead of wearing
      // `pk-nowrap` while still claiming slack.
      header: "Term",
      width: "fit",
      cell: (assignment) => formatTerm(assignment.startsAt, assignment.endsAt),
    },
    { header: "Source", cell: sourceLabel },
    {
      header: "Actions",
      className: "pk-end",
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

/** Reserved leadership segment that routes to the add page instead of one term's own. */
const ADD_LEADERSHIP_SEGMENT = "add";

export function GroupLeadership({
  groupId,
  assignmentSegment,
}: {
  groupId: string;
  /** `undefined` for the list, `"add"` for the add page, a userRoleId to edit one term. */
  assignmentSegment?: string;
}) {
  const leadership = useData(
    () =>
      getJson(
        `/api/v1/groups/${encodeURIComponent(groupId)}/leadership${assignmentSegment && assignmentSegment !== ADD_LEADERSHIP_SEGMENT ? `?userRoleId=${encodeURIComponent(assignmentSegment)}` : ""}`,
        groupLeadershipListResponseSchema,
      ),
    [groupId, assignmentSegment],
  );
  const currentTable = useRef<ApiTableActions | null>(null);
  const [view, setView] = useState("current");
  const [, navigate] = usePortalHashLocation();
  const leadershipPath = `/groups/${encodeURIComponent(groupId)}/leadership`;
  const [busyId, setBusyId] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);

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
      await Promise.all([leadership.reload(), currentTable.current?.reload()]);
    } catch (cause) {
      setMutationError(cause instanceof ApiClientError ? cause.message : "Could not end this leadership term.");
    } finally {
      setBusyId(null);
    }
  }

  /*
   * Adding and editing are pages, not panels that unfold above the table.
   *
   * Both forms used to open in place, which made the table the page and the
   * form a mode of it: nothing addressed the form, reloading lost it, and the
   * list the reader was leaving stayed underneath the thing they had moved on
   * to. They follow the Members roster's idiom instead — a reserved `add`
   * segment and one term at its own address — so a form is somewhere you go
   * and coming back is a navigation.
   *
   * The term is resolved from the address rather than handed over by the row
   * that opened it, so the page is a real place: opening it cold, or
   * reloading it, shows the same term.
   */
  const data: GroupLeadershipListResponse | null = leadership.data;
  const editingSegment = assignmentSegment && assignmentSegment !== ADD_LEADERSHIP_SEGMENT ? assignmentSegment : null;
  const editing =
    data && editingSegment
      ? ([...data.assignments, ...data.past].find(
          (candidate) => candidate.userRoleId === editingSegment && !candidate.inherited,
        ) ?? null)
      : null;
  /*
   * An address that names no local term of this group is not an empty editor:
   * an inherited row is edited at its source, and a userRoleId that belongs to
   * nobody here is a stale link. Either way the reader belongs back on the
   * list rather than in front of a form for nothing. The redirect is an
   * effect, not something render does on its way past.
   */
  const strayAddress = Boolean(data && editingSegment && !editing);
  useEffect(() => {
    if (strayAddress) navigate(leadershipPath);
  }, [strayAddress, leadershipPath, navigate]);

  if (leadership.loading && !leadership.data) return <Spinner label="Loading leadership…" />;

  if (data && assignmentSegment === ADD_LEADERSHIP_SEGMENT) {
    return (
      <GroupLeadershipAssignmentForm
        groupId={groupId}
        titles={data.titles}
        titleOptions={data.titleOptions}
        onAssigned={async () => {
          // Back to the list first: the reload is for the page being returned
          // to, and making the return wait on it leaves the reader looking at
          // a finished form for as long as the refresh takes.
          navigate(leadershipPath);
          await leadership.reload();
        }}
        onCancel={() => navigate(leadershipPath)}
      />
    );
  }

  if (data && editingSegment) {
    // The list the reader came from must not appear underneath in the
    // meantime: they asked for one term, and briefly showing the page they
    // left would be the wrong page.
    if (!editing) return <Spinner />;
    return (
      <GroupLeadershipTermForm
        groupId={groupId}
        assignment={editing}
        titleOptions={data.titleOptions}
        onSaved={async () => {
          navigate(leadershipPath);
          await leadership.reload();
        }}
        onCancel={() => navigate(leadershipPath)}
      />
    );
  }

  return (
    <div class="pk pk-stack">
      {mutationError && <ErrorAlert error={mutationError} />}
      <Panel aria-label="Leadership">
        <PanelHeader title="Leadership">
          {data && (
            <span class="pk-small pk-muted">
              {data.governanceInheritanceMode === "local_only" ? "Local only" : "Inherits parent leadership"}
            </span>
          )}
        </PanelHeader>
        <ApiDataTable
          key={view}
          toolbar={() => (
            <Select
              aria-label="Leadership status"
              value={view}
              onChange={(event) => setView(event.currentTarget.value)}
            >
              <option value="current">Current leadership</option>
              <option value="past">Past leadership</option>
            </Select>
          )}
          caption={view === "past" ? "Closed leadership terms of this group" : "Current leadership of this group"}
          endpoint={`/api/v1/groups/${encodeURIComponent(groupId)}/leadership`}
          responseSchema={groupLeadershipListResponseSchema}
          resolve={(response) => (view === "past" ? response.past : response.assignments)}
          resolvePage={(response) => (view === "past" ? response.pastPage : response.page)}
          paginate
          searchPlaceholder="Search leadership…"
          initialSort={view === "past" ? "-ends_at" : "person"}
          actionsRef={currentTable}
          createAction={{
            label: "Add leadership",
            onSelect: () => navigate(`${leadershipPath}/${ADD_LEADERSHIP_SEGMENT}`),
          }}
          columns={leadershipColumns(
            busyId,
            (assignment) => navigate(`${leadershipPath}/${encodeURIComponent(assignment.userRoleId)}`),
            view === "past" ? undefined : (assignment) => void endTerm(assignment),
          )}
          rowKey={(assignment) => assignment.userRoleId}
          rowAction={(assignment) => ({
            label: `Open ${assignment.userName}`,
            href: usePortalHashLocation.hrefs(`/users/${encodeURIComponent(assignment.userId)}`),
          })}
          empty={<EmptyState title={view === "past" ? "No past leadership found" : "No leadership found"} />}
        />
      </Panel>
    </div>
  );
}
