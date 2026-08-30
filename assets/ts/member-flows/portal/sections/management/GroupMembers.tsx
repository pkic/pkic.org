import { useState } from "preact/hooks";
import {
  groupMembershipMutationResponseSchema,
  groupMembershipsListResponseSchema,
  type GroupMembership,
} from "../../../../../shared/schemas/groups";
import { confirmAction } from "../../../../components/ConfirmDialog";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { Pager } from "../../../../components/Pager";
import { RowActions } from "../../../../components/RowActions";
import { Spinner } from "../../../../components/Spinner";
import { useApiPage } from "../../../../hooks/useApiPage";
import { ApiClientError, deleteJson } from "../../../../shared/api-client";
import { GroupMemberAddForm } from "./GroupMemberAddForm";

function capacityLabel(membership: GroupMembership): string {
  if (membership.memberType === "organization") return membership.organizationName ?? "Organization";
  return `Individual membership${membership.membershipCategory ? ` (${membership.membershipCategory})` : ""}`;
}

export function GroupMembers({ groupId, onChanged }: { groupId: string; onChanged: () => Promise<void> }) {
  const [pendingSearch, setPendingSearch] = useState("");
  const [search, setSearch] = useState("");
  const [endingId, setEndingId] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const page = useApiPage(
    `/api/v1/groups/${encodeURIComponent(groupId)}/memberships`,
    { active: "true", sort: "user_name", ...(search ? { q: search } : {}) },
    groupMembershipsListResponseSchema,
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
    <div class="card border-0 shadow-sm">
      <div class="card-header bg-white fw-semibold">Membership capacities</div>
      <div class="card-body d-flex flex-column gap-3">
        <p class="text-muted small mb-0">
          Each row is one person participating through one Member. A person representing multiple organizations may
          therefore appear more than once.
        </p>
        <GroupMemberAddForm
          groupId={groupId}
          onAdded={async () => {
            await Promise.all([page.reload(), onChanged()]);
          }}
        />
        <form
          class="d-flex gap-2 portal-management-search"
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            setSearch(pendingSearch.trim());
          }}
        >
          <label class="visually-hidden" for="managed-group-member-search">
            Search membership capacities
          </label>
          <input
            id="managed-group-member-search"
            type="search"
            class="form-control"
            placeholder="Search name, email, organization, or category…"
            value={pendingSearch}
            onInput={(event) => setPendingSearch((event.target as HTMLInputElement).value)}
          />
          <button type="submit" class="btn btn-outline-secondary">
            Search
          </button>
        </form>
        {page.error && <ErrorAlert error={page.error.message} />}
        {mutationError && <ErrorAlert error={mutationError} />}
        {page.data && page.data.memberships.length === 0 ? (
          <p class="text-muted mb-0">No matching active membership capacities.</p>
        ) : (
          <div class="table-responsive">
            <table class="table table-sm align-middle mb-0">
              <thead>
                <tr>
                  <th scope="col">Person</th>
                  <th scope="col">Participation capacity</th>
                  <th scope="col">Source</th>
                  <th scope="col" class="text-end">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody>
                {page.data?.memberships.map((membership) => (
                  <tr key={membership.id}>
                    <td>
                      <div class="fw-semibold">{membership.userName}</div>
                      <div class="small text-muted">{membership.email}</div>
                    </td>
                    <td>
                      <div>{capacityLabel(membership)}</div>
                      {membership.membershipCategory && (
                        <div class="small text-muted">Category {membership.membershipCategory}</div>
                      )}
                    </td>
                    <td>{membership.source.replaceAll("_", " ")}</td>
                    <td class="text-end">
                      <RowActions
                        label={`Actions for ${membership.userName}`}
                        actions={[
                          {
                            key: "remove",
                            label: endingId === membership.id ? "Removing…" : "Remove",
                            onSelect: () => void endMembership(membership),
                            disabled: endingId !== null,
                          },
                        ]}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {page.pagerProps && <Pager {...page.pagerProps} />}
      </div>
    </div>
  );
}
