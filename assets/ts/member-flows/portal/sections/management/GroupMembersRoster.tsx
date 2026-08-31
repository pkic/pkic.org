import { useState } from "preact/hooks";
import { groupMembershipsParticipantListResponseSchema } from "../../../../../shared/schemas/groups";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { Pager } from "../../../../components/Pager";
import { PersonCell } from "../../../../components/PersonCell";
import { Spinner } from "../../../../components/Spinner";
import { useApiPage } from "../../../../hooks/useApiPage";

/**
 * Read-only roster shown to a participant who cannot manage the group: who
 * else is here, and which organization they represent, if any. The backend
 * projection never includes email addresses or membership-capacity
 * identifiers, so there is nothing here to redact — no row menu, no add
 * action, no management column.
 */
export function GroupMembersRoster({ groupId }: { groupId: string }) {
  const [pendingSearch, setPendingSearch] = useState("");
  const [search, setSearch] = useState("");
  const page = useApiPage(
    `/api/v1/groups/${encodeURIComponent(groupId)}/memberships`,
    { sort: "user_name", ...(search ? { q: search } : {}) },
    groupMembershipsParticipantListResponseSchema,
    (data) => data.memberships,
    25,
  );

  if (!page.data && page.loading) return <Spinner label="Loading group members…" />;

  return (
    <div class="card border-0 shadow-sm">
      <div class="card-header bg-white fw-semibold">Members</div>
      <div class="card-body d-flex flex-column gap-3">
        <form
          class="d-flex gap-2 portal-management-search"
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            setSearch(pendingSearch.trim());
          }}
        >
          <label class="visually-hidden" for="group-roster-search">
            Search members
          </label>
          <input
            id="group-roster-search"
            type="search"
            class="form-control"
            placeholder="Search name or organization…"
            value={pendingSearch}
            onInput={(event) => setPendingSearch((event.target as HTMLInputElement).value)}
          />
          <button type="submit" class="btn btn-outline-secondary">
            Search
          </button>
        </form>
        {page.error && <ErrorAlert error={page.error.message} />}
        {page.data && page.data.memberships.length === 0 ? (
          <p class="text-muted mb-0">No matching members.</p>
        ) : (
          <ul class="list-unstyled d-flex flex-column gap-3 mb-0">
            {page.data?.memberships.map((participant, index) => (
              <li key={`${participant.userId}-${index}`}>
                <PersonCell
                  firstName={participant.name}
                  lastName={null}
                  email={null}
                  headshotUrl={participant.headshotUrl}
                  secondary={participant.organizationName}
                />
              </li>
            ))}
          </ul>
        )}
        {page.pagerProps && <Pager {...page.pagerProps} />}
      </div>
    </div>
  );
}
