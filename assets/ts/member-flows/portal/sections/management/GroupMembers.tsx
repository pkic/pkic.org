/**
 * The Members tab. A caller who cannot manage the group (only `participate`)
 * gets the read-only roster: no add-person action, no row menus, no email or
 * other management-only fields ever reach that request. A manager gets the
 * seat list: current or former, searchable, with each seat's title and
 * service dates, and the commands to add, edit, or end a seat.
 */
import { useState } from "preact/hooks";
import {
  groupMembershipMutationResponseSchema,
  groupMembershipsManagementListResponseSchema,
  type GroupMembership,
} from "../../../../../shared/schemas/groups";
import { confirmAction } from "../../../../components/ConfirmDialog";
import { EmptyState } from "../../../../components/EmptyState";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { Pager } from "../../../../components/Pager";
import { PersonCell } from "../../../../components/PersonCell";
import { RowActions } from "../../../../components/RowActions";
import { Spinner } from "../../../../components/Spinner";
import { Table } from "../../../../components/Table";
import { useApiPage } from "../../../../hooks/useApiPage";
import { ApiClientError, deleteJson } from "../../../../shared/api-client";
import { fmtCalendarDate } from "../../ui";
import { GroupMemberAddForm } from "./GroupMemberAddForm";
import { GroupMembersRoster } from "./GroupMembersRoster";
import { GroupMembershipSeatForm } from "./GroupMembershipSeatForm";
import { capacityLabel } from "./group-leadership";

const DEFAULT_SEAT_TITLE = "Member";

type SeatView = "current" | "former";

export function GroupMembers({
  groupId,
  canManage,
  onChanged,
}: {
  groupId: string;
  canManage: boolean;
  onChanged: () => Promise<void>;
}) {
  if (!canManage) return <GroupMembersRoster groupId={groupId} />;
  return <GroupMembersManager groupId={groupId} onChanged={onChanged} />;
}

function SeatViewFilter({ value, onChange }: { value: SeatView; onChange: (view: SeatView) => void }) {
  const views: ReadonlyArray<{ key: SeatView; label: string }> = [
    { key: "current", label: "Current" },
    { key: "former", label: "Former" },
  ];
  return (
    <div class="btn-group btn-group-sm" role="group" aria-label="Seats to show">
      {views.map((view) => (
        <button
          key={view.key}
          type="button"
          class={`btn ${value === view.key ? "btn-secondary" : "btn-outline-secondary"}`}
          aria-pressed={value === view.key}
          onClick={() => onChange(view.key)}
        >
          {view.label}
        </button>
      ))}
    </div>
  );
}

function GroupMembersManager({ groupId, onChanged }: { groupId: string; onChanged: () => Promise<void> }) {
  const [pendingSearch, setPendingSearch] = useState("");
  const [search, setSearch] = useState("");
  const [view, setView] = useState<SeatView>("current");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editing, setEditing] = useState<GroupMembership | null>(null);
  const page = useApiPage(
    `/api/v1/groups/${encodeURIComponent(groupId)}/memberships`,
    {
      active: view === "current" ? "true" : "false",
      sort: view === "current" ? "user_name" : "-left_at",
      ...(search ? { q: search } : {}),
    },
    groupMembershipsManagementListResponseSchema,
    (data) => data.memberships,
    25,
  );

  async function changed(): Promise<void> {
    await Promise.all([page.reload(), onChanged()]);
  }

  async function endMembership(membership: GroupMembership): Promise<void> {
    const label = `${membership.userName} on behalf of ${capacityLabel(membership)}`;
    if (
      !(await confirmAction({
        title: `End group participation for ${label}?`,
        body: "This ends only this seat; other seats held by the same person are not affected.",
        consequences: [
          `${membership.userName} immediately loses access granted through this seat`,
          "Leadership held through this seat ends with it",
          "The seat stays in the group's history as a former member",
        ],
        confirmLabel: "End participation",
      }))
    )
      return;
    setBusyId(membership.id);
    setMutationError(null);
    try {
      await deleteJson(
        `/api/v1/groups/${encodeURIComponent(groupId)}/memberships/${encodeURIComponent(membership.id)}`,
        groupMembershipMutationResponseSchema,
      );
      await changed();
    } catch (cause) {
      setMutationError(cause instanceof ApiClientError ? cause.message : "Could not end this membership capacity.");
    } finally {
      setBusyId(null);
    }
  }

  if (!page.data && page.loading) return <Spinner label="Loading members…" />;
  const memberships = page.data?.memberships ?? [];
  const heads = [
    "Person",
    "Represents",
    "Title",
    view === "current" ? "Since" : "Served",
    { label: "", className: "text-end" },
  ];

  return (
    <section class="card border-0 shadow-sm" aria-labelledby="group-members-heading">
      <div class="card-header bg-white d-flex flex-wrap justify-content-between align-items-center gap-2">
        <span id="group-members-heading" class="fw-semibold">
          Members
        </span>
        <button
          type="button"
          class="btn btn-sm btn-success"
          onClick={() => {
            setEditing(null);
            setShowAddForm(true);
          }}
        >
          Add person
        </button>
      </div>
      <div class="card-body d-flex flex-column gap-3">
        <p class="text-muted small mb-0">
          One seat is one person participating on behalf of one Member, so someone representing two organizations holds
          two seats. Seat dates are the roster history a governing body publishes.
        </p>
        {showAddForm && (
          <GroupMemberAddForm
            groupId={groupId}
            onAdded={async () => {
              await changed();
              setShowAddForm(false);
            }}
            onCancel={() => setShowAddForm(false)}
          />
        )}
        {editing && (
          <GroupMembershipSeatForm
            groupId={groupId}
            membership={editing}
            onSaved={async () => {
              await changed();
              setEditing(null);
            }}
            onCancel={() => setEditing(null)}
          />
        )}
        <div class="d-flex gap-2 align-items-center flex-wrap portal-management-search">
          <form
            class="d-flex gap-2 flex-grow-1"
            role="search"
            onSubmit={(event) => {
              event.preventDefault();
              setSearch(pendingSearch.trim());
            }}
          >
            <label class="visually-hidden" for="managed-group-member-search">
              Search members
            </label>
            <input
              id="managed-group-member-search"
              type="search"
              class="form-control form-control-sm"
              placeholder="Search name, email, organization, or category…"
              value={pendingSearch}
              onInput={(event) => setPendingSearch((event.target as HTMLInputElement).value)}
            />
            <button type="submit" class="btn btn-sm btn-outline-secondary">
              Search
            </button>
          </form>
          <SeatViewFilter value={view} onChange={setView} />
        </div>
        {page.error && <ErrorAlert error={page.error.message} />}
        {mutationError && <ErrorAlert error={mutationError} />}
        <Table
          heads={heads}
          empty={
            view === "current" ? (
              <EmptyState
                title={search ? "No matching members" : "No members yet"}
                body={
                  search
                    ? "Try another name, email, organization, or category."
                    : "Add the people who take part in this group, or record who served before."
                }
                action={search ? undefined : { label: "Add person", onSelect: () => setShowAddForm(true) }}
              />
            ) : (
              <EmptyState
                title={search ? "No matching former members" : "No former members"}
                body={
                  search
                    ? "Try another name, email, organization, or category."
                    : "Seats that end stay here as the group's history."
                }
              />
            )
          }
        >
          {memberships.length > 0 &&
            memberships.map((membership) => (
              <tr key={membership.id}>
                <td>
                  <PersonCell firstName={membership.userName} lastName={null} email={membership.email} />
                </td>
                <td>
                  <div>{capacityLabel(membership)}</div>
                  {membership.memberType === "organization" && membership.membershipCategory && (
                    <div class="small text-muted">Category {membership.membershipCategory}</div>
                  )}
                </td>
                <td>{membership.title ?? <span class="text-muted">{DEFAULT_SEAT_TITLE}</span>}</td>
                <td class="text-nowrap">
                  {fmtCalendarDate(membership.joinedAt)}
                  {membership.leftAt && ` – ${fmtCalendarDate(membership.leftAt)}`}
                </td>
                <td class="text-end">
                  <RowActions
                    label={`Actions for ${membership.userName}`}
                    actions={[
                      {
                        key: "edit",
                        label: "Edit seat",
                        onSelect: () => {
                          setShowAddForm(false);
                          setEditing(membership);
                        },
                        disabled: busyId !== null,
                      },
                      ...(membership.leftAt
                        ? []
                        : [
                            {
                              key: "remove",
                              label: busyId === membership.id ? "Ending…" : "End participation",
                              onSelect: () => void endMembership(membership),
                              disabled: busyId !== null,
                            },
                          ]),
                    ]}
                  />
                </td>
              </tr>
            ))}
        </Table>
        {page.pagerProps && <Pager {...page.pagerProps} />}
      </div>
    </section>
  );
}
