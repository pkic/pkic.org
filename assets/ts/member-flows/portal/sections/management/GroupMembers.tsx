import { useState } from "preact/hooks";
import {
  groupMembershipMutationResponseSchema,
  groupMembershipsManagementListResponseSchema,
  type GroupMembership,
} from "../../../../../shared/schemas/groups";
import { confirmAction } from "../../../../components/ConfirmDialog";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { Pager } from "../../../../components/Pager";
import { Button } from "../../../../ui/Button";
import { DataTable, type DataTableColumn } from "../../../../ui/DataTable";
import { EmptyState } from "../../../../ui/EmptyState";
import { Field } from "../../../../ui/Field";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
import { PersonCell } from "../../../../ui/PersonCell";
import { RowActions } from "../../../../ui/RowActions";
import { Spinner } from "../../../../components/Spinner";
import { TextInput } from "../../../../ui/TextControl";
import { useApiPage } from "../../../../hooks/useApiPage";
import { ApiClientError, deleteJson } from "../../../../shared/api-client";
import { GroupMemberAddForm } from "./GroupMemberAddForm";
import { GroupMembersRoster } from "./GroupMembersRoster";

function capacityLabel(membership: GroupMembership): string {
  if (membership.memberType === "organization") return membership.organizationName ?? "Organization";
  return `Individual membership${membership.membershipCategory ? ` (${membership.membershipCategory})` : ""}`;
}

function membershipColumns(
  endingId: string | null,
  onEnd: (membership: GroupMembership) => void,
): ReadonlyArray<DataTableColumn<GroupMembership>> {
  return [
    {
      id: "person",
      header: "Person",
      cell: (membership) => <PersonCell name={membership.userName} email={membership.email} size="sm" />,
    },
    {
      id: "capacity",
      header: "Participation capacity",
      cell: (membership) => (
        <span class="pk-stack pk-stack--tight">
          <span>{capacityLabel(membership)}</span>
          {membership.membershipCategory && <span class="pk-small">Category {membership.membershipCategory}</span>}
        </span>
      ),
    },
    {
      id: "source",
      header: "Source",
      cellClass: "pk-nowrap",
      cell: (membership) => membership.source.replaceAll("_", " "),
    },
    {
      // The header used to read "Action" and was rendered visibly above a
      // column of menus, which names the column after the control rather than
      // after what the column holds. It names the row's subject for assistive
      // technology now and shows nothing.
      id: "actions",
      header: "Actions",
      headerHidden: true,
      align: "end",
      cell: (membership) => (
        <RowActions
          subject={membership.userName}
          actions={[
            {
              id: "remove",
              label: endingId === membership.id ? "Removing…" : "Remove",
              onSelect: () => {
                onEnd(membership);
              },
              disabled: endingId !== null,
            },
          ]}
        />
      ),
    },
  ];
}

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
  const [pendingSearch, setPendingSearch] = useState("");
  const [search, setSearch] = useState("");
  const [endingId, setEndingId] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const page = useApiPage(
    `/api/v1/groups/${encodeURIComponent(groupId)}/memberships`,
    { active: "true", sort: "user_name", ...(search ? { q: search } : {}) },
    groupMembershipsManagementListResponseSchema,
    (data) => data.memberships,
    25,
  );

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
      await Promise.all([page.reload(), onChanged()]);
    } catch (cause) {
      setMutationError(cause instanceof ApiClientError ? cause.message : "Could not end this membership capacity.");
    } finally {
      setEndingId(null);
    }
  }

  if (!page.data && page.loading) return <Spinner label="Loading membership capacities…" />;

  return (
    // The panel names itself: the group workspace stacks several of these, and
    // an unnamed <section> is announced as nothing at all.
    <Panel class="pk" aria-label="Membership capacities">
      <PanelHeader title="Membership capacities">
        <Button size="sm" variant="primary" onClick={() => setShowAddForm(true)}>
          Add person
        </Button>
      </PanelHeader>
      <PanelBody class="pk-stack">
        <p class="pk-muted pk-small">
          Each row is one person participating through one Member. A person representing multiple organizations may
          therefore appear more than once.
        </p>
        {showAddForm && (
          <GroupMemberAddForm
            groupId={groupId}
            onAdded={async () => {
              await Promise.all([page.reload(), onChanged()]);
              setShowAddForm(false);
            }}
            onCancel={() => setShowAddForm(false)}
          />
        )}
        {/* The search runs on submit rather than on every keystroke, so the
            field and its button are stacked rather than clustered: the label
            sits above the control, which no cluster can align a button to
            without guessing at the label's height. */}
        <form
          class="pk-stack pk-stack--snug"
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            setSearch(pendingSearch.trim());
          }}
        >
          <Field
            label="Search membership capacities"
            help="Matches a person's name or email, the organization they represent, or the membership category."
          >
            {(control) => (
              <TextInput
                {...control}
                type="search"
                placeholder="Search name, email, organization, or category…"
                value={pendingSearch}
                onInput={(event) => setPendingSearch((event.target as HTMLInputElement).value)}
              />
            )}
          </Field>
          <div class="pk-cluster">
            <Button type="submit" size="sm">
              Search
            </Button>
          </div>
        </form>
        {mutationError && <ErrorAlert error={mutationError} />}
        {/* A failed load replaces the table rather than sitting above an empty
            one: "No matching active membership capacities" is a claim about
            the group, and the surface does not know that when the request did
            not arrive. */}
        {page.error ? (
          <ErrorAlert error={page.error.message} />
        ) : (
          <DataTable
            caption="Active membership capacities in this group"
            columns={membershipColumns(endingId, (membership) => void endMembership(membership))}
            rows={page.data?.memberships ?? []}
            rowKey={(membership) => membership.id}
            loading={page.loading}
            empty={
              <EmptyState
                title="No matching active membership capacities."
                body="Nobody participates in this group through a Member capacity that matches this search."
              />
            }
          />
        )}
        {page.pagerProps && <Pager {...page.pagerProps} />}
      </PanelBody>
    </Panel>
  );
}
