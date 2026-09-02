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
import { fmtDate } from "../../ui";
import { GroupMemberAddForm } from "./GroupMemberAddForm";
import { GroupMembersRoster } from "./GroupMembersRoster";

/** Who they participate for, said in the row's own words. */
function capacityLabel(membership: GroupMembership): string {
  if (membership.memberType === "organization") return membership.organizationName ?? "Organization";
  return "Individual member";
}

/** How the membership came to be, in product language rather than enum keys. */
const SOURCE_LABELS: Record<GroupMembershipSource, string> = {
  self_service: "Joined",
  organization_contact: "Added by their organization",
  staff: "Added by staff",
  automatic_policy: "Enrolled automatically",
  migration: "Migrated",
};

/**
 * The Members tab. A caller who cannot manage the group (only `participate`)
 * delegates to the read-only roster: no add-person action, no row menus, no
 * email or other management-only fields ever reach that request.
 */
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
  const [endingId, setEndingId] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const listActions = useRef<ApiTableActions | null>(null);

  async function endMembership(membership: GroupMembership): Promise<void> {
    const label = `${membership.userName} on behalf of ${capacityLabel(membership)}`;
    if (
      !(await confirmAction({
        title: `End group participation for ${label}?`,
        body: "This ends only this membership capacity; other capacities held by the same person are not affected.",
        consequences: [
          `${membership.userName} immediately loses access granted through this capacity`,
          "They can be added back later if their participation resumes",
        ],
        confirmLabel: "End participation",
      }))
    )
      return;
    setEndingId(membership.id);
    setMutationError(null);
    try {
      await deleteJson(
        `/api/v1/groups/${encodeURIComponent(groupId)}/memberships/${encodeURIComponent(membership.id)}`,
        groupMembershipMutationResponseSchema,
      );
      await Promise.all([listActions.current?.reload(), onChanged()]);
    } catch (cause) {
      setMutationError(cause instanceof ApiClientError ? cause.message : "Could not end this membership.");
    } finally {
      setEndingId(null);
    }
  }

  return (
    <div class="pk pk-stack">
      {showAddForm && (
        <GroupMemberAddForm
          groupId={groupId}
          onAdded={async () => {
            await Promise.all([listActions.current?.reload(), onChanged()]);
            setShowAddForm(false);
          }}
          onCancel={() => setShowAddForm(false)}
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
        params={{ active: "true" }}
        actionsRef={listActions}
        searchPlaceholder="Search name, email, organization, or category…"
        createAction={{ label: "Add person", onSelect: () => setShowAddForm(true) }}
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
            header: "Joined",
            width: "fit",
            cell: (membership: GroupMembership) => fmtDate(membership.joinedAt),
            sort: { asc: "joined_at", desc: "-joined_at", defaultDirection: "desc" },
          },
          {
            header: "Source",
            width: "fit",
            cell: (membership: GroupMembership) => SOURCE_LABELS[membership.source] ?? membership.source,
          },
          {
            header: "",
            cell: (membership: GroupMembership) => (
              <RowActions
                subject={membership.userName}
                actions={[
                  {
                    id: "remove",
                    label: endingId === membership.id ? "Removing…" : "Remove",
                    onSelect: () => {
                      void endMembership(membership);
                    },
                    disabled: endingId !== null,
                  },
                ]}
              />
            ),
          },
        ]}
        empty={
          <EmptyState
            title="No members match"
            body="Nobody participates in this group through a membership that matches this search."
          />
        }
        rowKey={(membership: GroupMembership) => membership.id}
      />
    </div>
  );
}
