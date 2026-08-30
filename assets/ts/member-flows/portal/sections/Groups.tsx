/** Generic self-service participation view shared by every configured group type. */
import type { z } from "zod";
import { useHashLocation } from "wouter/use-hash-location";
import { groupSchema, groupsListResponseSchema } from "../../../../shared/schemas/groups";
import { selfGroupsListResponseSchema } from "../../../../shared/schemas/group-participation";
import { ApiDataTable } from "../../../components/ApiDataTable";
import { Badge } from "../../../components/Badge";
import { ErrorAlert } from "../../../components/ErrorAlert";
import { Pager } from "../../../components/Pager";
import { Spinner } from "../../../components/Spinner";
import { useApiPage } from "../../../hooks/useApiPage";
import { ApiClientError } from "../../../shared/api-client";
import { portalSession } from "../state";
import { refreshPortalSidebarGroups } from "../shell/SidebarGroups";
import { GroupParticipationCard } from "./GroupParticipationCard";
import { GroupCreateForm } from "./management/GroupCreateForm";
import { ProposalPrograms } from "./management/ProposalPrograms";

type SelfGroupsPage = z.infer<typeof selfGroupsListResponseSchema>;
type Group = z.infer<typeof groupSchema>;

function MemberGroupCatalog() {
  const catalog = useApiPage<SelfGroupsPage>(
    "/api/v1/users/current/groups",
    { view: "catalog" },
    selfGroupsListResponseSchema,
    (data) => data.groups,
  );
  const groups = catalog.data?.groups ?? [];

  if (catalog.error) {
    return (
      <ErrorAlert error={catalog.error instanceof ApiClientError ? catalog.error.message : "Could not load groups."} />
    );
  }
  if (!catalog.data) return <Spinner />;
  if (groups.length === 0 && !catalog.data.page.hasMore) {
    return <p class="text-muted">No groups are available right now.</p>;
  }

  return (
    <>
      <p class="text-muted small">
        Join or leave groups using the Member affiliations you currently represent. All eligible affiliations are
        selected by default; clear one to join for an explicit subset.
      </p>
      {groups.map((group) => (
        <GroupParticipationCard
          key={group.id}
          group={group}
          onChanged={async () => {
            refreshPortalSidebarGroups();
            await catalog.reload();
          }}
        />
      ))}
      {catalog.pagerProps && <Pager {...catalog.pagerProps} />}
    </>
  );
}

function ManagedGroups() {
  const [, navigate] = useHashLocation();

  return (
    <div class="card border-0 shadow-sm">
      <div class="card-header bg-white fw-semibold">Managed groups</div>
      <div class="card-body">
        <ApiDataTable
          endpoint="/api/v1/groups"
          params={{ manageable: "true" }}
          responseSchema={groupsListResponseSchema}
          resolve={(response) => response.groups}
          resolvePage={(response) => response.page}
          paginate
          initialSort="name"
          searchPlaceholder="Search managed groups…"
          columns={[
            {
              header: "Group",
              cell: (group: Group) => (
                <div>
                  <div class="fw-semibold">{group.name}</div>
                  <div class="small text-muted">{group.type.singularLabel}</div>
                </div>
              ),
              sort: { asc: "name", desc: "-name", defaultDirection: "asc" },
            },
            {
              header: "Status",
              cell: (group: Group) =>
                group.active ? <Badge status="active" label="Active" /> : <Badge status="inactive" label="Inactive" />,
            },
            {
              header: "",
              className: "text-end",
              cell: () => <span class="btn btn-sm btn-outline-secondary">Open</span>,
            },
          ]}
          empty="No groups are manageable with your current permissions."
          rowKey={(group: Group) => group.id}
          onRowClick={(group: Group) => navigate(`/groups/${encodeURIComponent(group.id)}/overview`)}
        />
      </div>
    </div>
  );
}

export function Groups() {
  const [, navigate] = useHashLocation();
  const session = portalSession.value;

  return (
    <div class="d-flex flex-column gap-3 content-width-schedule">
      {session?.member && <MemberGroupCatalog />}
      {session?.staff && <ManagedGroups />}
      {session?.staff && <ProposalPrograms />}
      {session?.staff && (
        <GroupCreateForm
          onCreated={(created) => {
            refreshPortalSidebarGroups();
            navigate(`/groups/${encodeURIComponent(created.id)}/settings`);
          }}
        />
      )}
    </div>
  );
}
