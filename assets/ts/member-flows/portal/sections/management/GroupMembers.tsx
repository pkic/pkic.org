import { useMembershipCategoryLabels } from "../../../../hooks/useMembershipCategoryLabels";
/**
 * The Members tab. A caller who cannot manage the group (only `participate`)
 * gets the read-only roster: no add-person action, no row menus, no email or
 * other management-only fields ever reach that request. A manager gets the
 * seat list: current or former, searchable, with each seat's title and
 * service dates, and the commands to add, edit, or end a seat.
 */
import { useEffect, useRef, useState } from "preact/hooks";
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
import { Spinner } from "../../../../components/Spinner";
import { PersonCell } from "../../../../ui/PersonCell";
import { RowActions } from "../../../../ui/RowActions";
import { deleteJson, getJson, ApiClientError } from "../../../../shared/api-client";
import { fmtCalendarDate } from "../../ui";
import { GroupMemberAddForm } from "./GroupMemberAddForm";
import { GroupMembersRoster } from "./GroupMembersRoster";
import { GroupMembershipSeatForm } from "./GroupMembershipSeatForm";
import { capacityLabel } from "./group-leadership";
import { usePortalHashLocation } from "../../hash-location";

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

/** Reserved seat segment that routes to the add page instead of a seat's own. */
const ADD_SEAT_SEGMENT = "add";

type SeatView = "current" | "former";

export function GroupMembers({
  groupId,
  canManage,
  seatSegment,
  onChanged,
}: {
  groupId: string;
  canManage: boolean;
  /** `undefined` for the roster, `"add"` for the add page, a seat id to edit one. */
  seatSegment?: string;
  onChanged: () => Promise<void>;
}) {
  if (!canManage) return <GroupMembersRoster groupId={groupId} />;
  return <GroupMembersManager groupId={groupId} seatSegment={seatSegment} onChanged={onChanged} />;
}

function GroupMembersManager({
  groupId,
  seatSegment,
  onChanged,
}: {
  groupId: string;
  seatSegment?: string;
  onChanged: () => Promise<void>;
}) {
  const [, navigate] = usePortalHashLocation();
  const categories = useMembershipCategoryLabels();
  const membersPath = `/groups/${encodeURIComponent(groupId)}/members`;
  const [view, setView] = useState<SeatView>("current");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [editing, setEditing] = useState<GroupMembership | null>(null);
  const listActions = useRef<ApiTableActions | null>(null);

  /*
   * The seat being edited is loaded from its own address rather than handed
   * over by the row that opened it, so the page is a real place: opening it
   * cold, or reloading it, shows the same seat. The roster narrowed to one
   * membership is the read — the collection is the canonical listing, and a
   * second read model for one row would be a second answer to one question.
   */
  useEffect(() => {
    if (!seatSegment || seatSegment === ADD_SEAT_SEGMENT) {
      setEditing(null);
      return;
    }
    let cancelled = false;
    void getJson(
      `/api/v1/groups/${encodeURIComponent(groupId)}/memberships?limit=1&offset=0&membershipId=${encodeURIComponent(seatSegment)}`,
      groupMembershipsManagementListResponseSchema,
    )
      .then((page) => {
        if (cancelled) return;
        const seat = page.memberships.find((candidate) => candidate.id === seatSegment);
        if (seat) setEditing(seat);
        else navigate(membersPath);
      })
      .catch(() => {
        if (!cancelled) navigate(membersPath);
      });
    return () => {
      cancelled = true;
    };
  }, [seatSegment, groupId, membersPath, navigate]);

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

  if (seatSegment === ADD_SEAT_SEGMENT) {
    // The add page supplies its own heading and its way back, so nothing is
    // wrapped around it here — and the roster it adds to is not underneath it.
    return (
      <GroupMemberAddForm
        groupId={groupId}
        onAdded={async () => {
          // Back to the roster first: the reload is for the page being
          // returned to, and making the return wait on it leaves the reader
          // on a finished form if anything about the refresh is slow.
          navigate(membersPath);
          await changed();
        }}
        onCancel={() => navigate(membersPath)}
      />
    );
  }

  if (seatSegment) {
    // The seat is still being read from its address. The roster must not
    // appear underneath in the meantime: the reader asked for one seat, and
    // showing the list they came from would be the wrong page briefly.
    if (!editing) return <Spinner />;
    return (
      <GroupMembershipSeatForm
        groupId={groupId}
        membership={editing}
        onSaved={async () => {
          navigate(membersPath);
          await changed();
        }}
        onCancel={() => navigate(membersPath)}
      />
    );
  }

  return (
    <div class="pk pk-stack">
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
        createAction={{
          label: "Add person",
          onSelect: () => navigate(`${membersPath}/${ADD_SEAT_SEGMENT}`),
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
            cell: (membership: GroupMembership) => categories.label(membership.membershipCategory) || "—",
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
                    onSelect: () => navigate(`${membersPath}/${encodeURIComponent(membership.id)}`),
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
