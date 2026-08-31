/** Generic self-service participation view shared by every configured group type. */
import { useState } from "preact/hooks";
import type { z } from "zod";
import { usePortalHashLocation } from "../hash-location";
import { groupSchema, groupsListResponseSchema } from "../../../../shared/schemas/groups";
import { selfGroupsListResponseSchema } from "../../../../shared/schemas/group-participation";
import { ApiDataTable } from "../../../components/ApiDataTable";
import { Badge } from "../../../components/Badge";
import { EmptyState } from "../../../components/EmptyState";
import { ErrorAlert } from "../../../components/ErrorAlert";
import { Pager } from "../../../components/Pager";
import { Spinner } from "../../../components/Spinner";
import { useApiPage } from "../../../hooks/useApiPage";
import { ApiClientError } from "../../../shared/api-client";
import { portalHasGlobalPermission } from "../shell/portal-navigation";
import { portalSession } from "../state";
import { refreshPortalSidebarGroups } from "../shell/SidebarGroups";
import { GroupParticipationCard } from "./GroupParticipationCard";
import { GroupCreateForm } from "./management/GroupCreateForm";

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

function AllGroups({ onCreate }: { onCreate?: () => void }) {
  return (
    <div class="card border-0 shadow-sm">
      <div class="card-header bg-white fw-semibold">All groups</div>
      <div class="card-body">
        <ApiDataTable
          caption="All groups"
          urlState="groups"
          endpoint="/api/v1/groups"
          responseSchema={groupsListResponseSchema}
          resolve={(response) => response.groups}
          resolvePage={(response) => response.page}
          createAction={onCreate ? { label: "New group", onSelect: onCreate } : undefined}
          paginate
          initialSort="name"
          searchPlaceholder="Search groups…"
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
              cell: (group: Group) => (group.active ? <span class="text-muted">—</span> : <Badge status="inactive" />),
            },
          ]}
          empty={
            onCreate ? (
              <EmptyState title="No groups yet" body="Create a group to get started." />
            ) : (
              "No groups are visible to your identity."
            )
          }
          rowKey={(group: Group) => group.id}
          rowAction={(group: Group) => ({
            label: `Open ${group.name}`,
            href: `#/groups/${encodeURIComponent(group.id)}/overview`,
          })}
        />
      </div>
    </div>
  );
}

export function Groups() {
  const [, navigate] = usePortalHashLocation();
  const [creating, setCreating] = useState(false);
  const session = portalSession.value;
  const canCreateGroups = portalHasGlobalPermission(session, "groups:write");

  if (creating && canCreateGroups) {
    return (
      <div class="d-flex flex-column gap-3 content-width-schedule">
        <div>
          <button type="button" class="btn btn-sm btn-outline-secondary" onClick={() => setCreating(false)}>
            ← All groups
          </button>
        </div>
        <GroupCreateForm
          onCreated={(created) => {
            refreshPortalSidebarGroups();
            navigate(`/groups/${encodeURIComponent(created.id)}/settings`);
          }}
        />
      </div>
    );
  }

  return (
    <div class="d-flex flex-column gap-3 content-width-schedule">
      {canCreateGroups && session?.member && (
        <div class="d-flex justify-content-end">
          <button type="button" class="btn btn-sm btn-success" onClick={() => setCreating(true)}>
            New group
          </button>
        </div>
      )}
      {session?.member && <MemberGroupCatalog />}
      {session?.staff && !session.member && (
        <AllGroups onCreate={canCreateGroups ? () => setCreating(true) : undefined} />
      )}
    </div>
  );
}
