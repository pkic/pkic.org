/** Generic self-service participation view shared by every configured group type. */
import { useEffect } from "preact/hooks";
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
import { Button } from "../../../ui/Button";
import { Panel, PanelBody, PanelHeader } from "../../../ui/Panel";
import { ApiClientError } from "../../../shared/api-client";
import { portalHasGlobalPermission } from "../shell/portal-navigation";
import { portalSession } from "../state";
import { refreshPortalSidebarGroups } from "../shell/SidebarGroups";
import { GroupParticipationCard } from "./GroupParticipationCard";
import { GroupCreateForm } from "./management/GroupCreateForm";

type SelfGroupsPage = z.infer<typeof selfGroupsListResponseSchema>;
type Group = z.infer<typeof groupSchema>;

/** Reserved group-id segment that routes to the creation page instead of a group's workspace. */
const NEW_GROUP_SEGMENT = "new";

const GROUPS_PATH = "/groups";

/** Redirects back to the catalog from an effect, not render — see its call site below. */
function GroupsRedirect({ navigate }: { navigate: (path: string) => void }) {
  useEffect(() => navigate(GROUPS_PATH), [navigate]);
  return null;
}

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
    return <EmptyState title="No groups are available right now." />;
  }

  return (
    <>
      <p class="pk-small">
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
    <Panel aria-label="All groups">
      <PanelHeader title="All groups" />
      <PanelBody>
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
                  <div class="pk-strong">{group.name}</div>
                  <div class="pk-small">{group.type.singularLabel}</div>
                </div>
              ),
              sort: { asc: "name", desc: "-name", defaultDirection: "asc" },
            },
            {
              header: "Status",
              /*
               * An active group used to be a faint dash and nothing else — a
               * status carried by looking quiet, which a screen reader cannot
               * hear. The dash stays as the visual, and the word goes beside
               * it for anyone not reading the greys.
               */
              cell: (group: Group) =>
                group.active ? (
                  <>
                    <span class="pk-muted" aria-hidden="true">
                      —
                    </span>
                    <span class="pk-sr-only">Active</span>
                  </>
                ) : (
                  <Badge status="inactive" />
                ),
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
      </PanelBody>
    </Panel>
  );
}

/**
 * Portal route adapter for the groups surface: the catalog, and — under the
 * reserved `new` segment — the create page. Creation is a place with its own
 * address, so it survives a reload and the browser's Back button closes it.
 */
export function Groups({
  groupSegment,
}: {
  /** `undefined` for the catalog, `"new"` for the create page. */
  groupSegment?: string;
} = {}) {
  const [, navigate] = usePortalHashLocation();
  const session = portalSession.value;
  const canCreateGroups = portalHasGlobalPermission(session, "groups:write");

  function openCreatePage(): void {
    navigate(`${GROUPS_PATH}/${NEW_GROUP_SEGMENT}`);
  }

  if (groupSegment === NEW_GROUP_SEGMENT) {
    // Navigating away belongs in an effect, not in render.
    if (!canCreateGroups) return <GroupsRedirect navigate={navigate} />;
    return (
      <div class="pk pk-stack content-width-schedule">
        <div class="pk-cluster">
          <Button variant="secondary" size="sm" onClick={() => navigate(GROUPS_PATH)}>
            <span aria-hidden="true">←</span> All groups
          </Button>
        </div>
        <GroupCreateForm
          onCreated={(created) => {
            refreshPortalSidebarGroups();
            navigate(`${GROUPS_PATH}/${encodeURIComponent(created.id)}/settings`);
          }}
          onCancel={() => navigate(GROUPS_PATH)}
        />
      </div>
    );
  }

  return (
    <div class="pk pk-stack content-width-schedule">
      {canCreateGroups && session?.member && (
        <div class="pk-cluster pk-cluster--end">
          <Button variant="primary" size="sm" onClick={openCreatePage}>
            New group
          </Button>
        </div>
      )}
      {session?.member && <MemberGroupCatalog />}
      {session?.staff && !session.member && <AllGroups onCreate={canCreateGroups ? openCreatePage : undefined} />}
    </div>
  );
}
