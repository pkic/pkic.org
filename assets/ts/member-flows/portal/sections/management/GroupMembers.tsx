/**
 * The Members tab. A caller who cannot manage the group (only `participate`)
 * gets the read-only roster: no add-person action, no row menus, no email or
 * other management-only fields ever reach that request. A manager gets the
 * seat list: current or former, searchable, with each seat's title and
 * service dates, and the commands to add, edit, or end a seat.
 */
import { useRef, useState } from "preact/hooks";
import {
  groupMembershipMutationResponseSchema,
  groupMembershipsManagementListResponseSchema,
  type GroupMembership,
  type GroupMembershipSource,
} from "../../../../../shared/schemas/groups";
import { ApiDataTable, type ApiTableActions } from "../../../../components/ApiDataTable";
import { confirmAction } from "../../../../components/ConfirmDialog";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { EmptyState } from "../../../../ui/EmptyState";
import { PersonCell } from "../../../../ui/PersonCell";
import { RowActions } from "../../../../ui/RowActions";
import { deleteJson, ApiClientError } from "../../../../shared/api-client";
import { fmtCalendarDate } from "../../ui";
import { GroupMemberAddForm } from "./GroupMemberAddForm";
import { GroupMembersRoster } from "./GroupMembersRoster";
import { GroupMembershipSeatForm } from "./GroupMembershipSeatForm";
import { capacityLabel } from "./group-leadership";

/** How the membership came to be, in product language rather than enum keys. */
const SOURCE_LABELS: Record<GroupMembershipSource, string> = {
  self_service: "Joined",
  organization_contact: "Added by their organization",
  staff: "Added by staff",
  automatic_policy: "Enrolled automatically",
  migration: "Migrated",
};

/** A seat with no title of its own is simply a member of the group. */
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

function GroupMembersManager({ groupId, onChanged }: { groupId: string; onChanged: () => Promise<void> }) {
  const [view, setView] = useState<SeatView>("current");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editing, setEditing] = useState<GroupMembership | null>(null);
  const listActions = useRef<ApiTableActions | null>(null);

  async function changed(): Promise<void> {
    await Promise.all([listActions.current?.reload(), onChanged()]);
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
      setMutationError(cause instanceof ApiClientError ? cause.message : "Could not end this membership.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div class="pk pk-stack">
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
      {mutationError && <ErrorAlert error={mutationError} />}
      <ApiDataTable
        caption="Members"
        endpoint={`/api/v1/groups/${encodeURIComponent(groupId)}/memberships`}
        responseSchema={groupMembershipsManagementListResponseSchema}
        resolve={(response) => response.memberships}
        resolvePage={(response) => response.page}
        paginate
        initialSort="user_name"
        actionsRef={listActions}
        searchPlaceholder="Search name, email, organization, or category…"
        /*
         * Inside the list's own panel, under the toolbar that opened it —
         * which is where the form's heading level already assumed it was, and
         * where "Add person" is. It used to render as a sibling above the
         * panel, so the form and the button that opens it sat in different
         * regions and neither named the other.
         */
        inset={
          showAddForm ? (
            <GroupMemberAddForm
              groupId={groupId}
              onAdded={async () => {
                await changed();
                setShowAddForm(false);
              }}
              onCancel={() => setShowAddForm(false)}
            />
          ) : undefined
        }
        createAction={{
          label: "Add person",
          onSelect: () => {
            setEditing(null);
            setShowAddForm(true);
          },
        }}
        // One seat is one person participating on behalf of one Member, and a
        // seat that ends stays as the group's history: the roster a governing
        // body publishes is the current seats, so that is what opens.
        initialFilters={{ active: "true" }}
        onFiltersChange={(filters) => setView(filters.active === "false" ? "former" : "current")}
        columns={[
          {
            header: "Person",
            // The person is the row's subject, so a wide screen's slack
            // lands here.
            width: "primary",
            cell: (membership: GroupMembership) => (
              <PersonCell name={membership.userName} email={membership.email} size="sm" />
            ),
            sort: { asc: "user_name", desc: "-user_name", defaultDirection: "asc" },
          },
          {
            // The title is what this seat is called on the published roster;
            // most seats are simply members and say so.
            header: "Title",
            cell: (membership: GroupMembership) =>
              membership.title ?? <span class="pk-muted">{DEFAULT_SEAT_TITLE}</span>,
          },
          {
            // A person representing several organizations appears once per
            // organization; this column is what tells those rows apart.
            header: "Represents",
            cell: (membership: GroupMembership) => capacityLabel(membership),
            sort: { asc: "organization_name", desc: "-organization_name", defaultDirection: "asc" },
          },
          {
            header: "Category",
            width: "fit",
            cell: (membership: GroupMembership) => membership.membershipCategory ?? "—",
            sort: { asc: "membership_category", desc: "-membership_category", defaultDirection: "asc" },
          },
          {
            header: "Source",
            cell: (membership: GroupMembership) => SOURCE_LABELS[membership.source] ?? membership.source,
            hideable: true,
          },
          {
            header: "Seat",
            width: "fit",
            cell: (membership: GroupMembership) =>
              membership.leftAt
                ? `${fmtCalendarDate(membership.joinedAt)} – ${fmtCalendarDate(membership.leftAt)}`
                : fmtCalendarDate(membership.joinedAt),
            sort: { asc: "joined_at", desc: "-joined_at", defaultDirection: "desc" },
            // Current or former is a property of the seat, so the choice
            // between the two rosters sits in this column's own menu.
            filter: {
              param: "active",
              options: [
                { value: "true", label: "Current seats" },
                { value: "false", label: "Former seats" },
              ],
            },
          },
          {
            // An empty header is the row's actions: named for assistive
            // technology, unlabelled on screen, and at the end of the row.
            header: "",
            cell: (membership: GroupMembership) => (
              <RowActions
                subject={membership.userName}
                actions={[
                  {
                    id: "edit",
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
                          id: "end",
                          label: busyId === membership.id ? "Ending…" : "End participation",
                          onSelect: () => void endMembership(membership),
                          disabled: busyId !== null,
                        },
                      ]),
                ]}
              />
            ),
          },
        ]}
        empty={
          view === "current" ? (
            <EmptyState
              title="No members yet"
              body="Add the people who take part in this group, or record who served before."
            />
          ) : (
            <EmptyState title="No former members" body="Seats that end stay here as the group's history." />
          )
        }
      />
    </div>
  );
}
