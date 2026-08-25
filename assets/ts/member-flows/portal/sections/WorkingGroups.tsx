/** Working-group context over the generic group self-participation model. */
import type { z } from "zod";
import { selfGroupsListResponseSchema } from "../../../../shared/schemas/group-participation";
import { ErrorAlert } from "../../../components/ErrorAlert";
import { Pager } from "../../../components/Pager";
import { Spinner } from "../../../components/Spinner";
import { useApiPage } from "../../../hooks/useApiPage";
import { ApiClientError } from "../../../shared/api-client";
import { GroupParticipationCard } from "./GroupParticipationCard";

type SelfGroupsPage = z.infer<typeof selfGroupsListResponseSchema>;

export function WorkingGroups() {
  const catalog = useApiPage<SelfGroupsPage>(
    "/api/v1/me/groups",
    { view: "catalog", typeKey: "working_group" },
    selfGroupsListResponseSchema,
    (data) => data.groups,
  );
  const groups = catalog.data?.groups ?? [];

  if (catalog.error) {
    return (
      <ErrorAlert
        error={catalog.error instanceof ApiClientError ? catalog.error.message : "Could not load working groups."}
      />
    );
  }
  if (!catalog.data) return <Spinner />;
  if (groups.length === 0 && !catalog.data.page.hasMore) {
    return <p class="text-muted">No working groups are available right now.</p>;
  }

  return (
    <div class="d-flex flex-column gap-3 content-width-schedule">
      <p class="text-muted small">
        Join or leave working groups using the Member affiliations you currently represent. All eligible affiliations
        are selected by default; clear one to join for an explicit subset.
      </p>
      {groups.map((group) => (
        <GroupParticipationCard key={group.id} group={group} onChanged={catalog.reload} />
      ))}
      {catalog.pagerProps && <Pager {...catalog.pagerProps} />}
    </div>
  );
}
