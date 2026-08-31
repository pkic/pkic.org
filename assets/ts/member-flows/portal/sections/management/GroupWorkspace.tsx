/**
 * The selected-group workspace: one URL-addressed context whose tabs derive
 * from the identity's live capabilities in that group. The same views serve
 * members, leaders, and staff — the backend decides what each may do.
 */
import { lazy, Suspense } from "preact/compat";
import { Link } from "wouter";
import {
  authenticatedGroupDetailResponseSchema,
  type AuthenticatedGroup,
  type GroupCapability,
  type GroupSettingsDetail,
} from "../../../../../shared/schemas/groups";
import { selfGroupsListResponseSchema } from "../../../../../shared/schemas/group-participation";
import { Badge } from "../../../../components/Badge";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { Spinner } from "../../../../components/Spinner";
import { useData } from "../../../../hooks/useData";
import { getJson } from "../../../../shared/api-client";
import { portalSession } from "../../state";
import { refreshPortalSidebarGroups } from "../../shell/SidebarGroups";
import { GroupParticipationCard } from "../GroupParticipationCard";
import { groupContextNavigation } from "./group-context-navigation";

const GroupSettingsForm = lazy(() =>
  import("./GroupSettingsForm").then((module) => ({ default: module.GroupSettingsForm })),
);
const GroupCategoryRulesEditor = lazy(() =>
  import("./GroupCategoryRulesEditor").then((module) => ({ default: module.GroupCategoryRulesEditor })),
);
const GroupMembers = lazy(() => import("./GroupMembers").then((module) => ({ default: module.GroupMembers })));
const GroupLeadership = lazy(() => import("./GroupLeadership").then((module) => ({ default: module.GroupLeadership })));
const GroupMeetings = lazy(() => import("./GroupMeetings").then((module) => ({ default: module.GroupMeetings })));
const GroupAuditLog = lazy(() => import("./GroupAuditLog").then((module) => ({ default: module.GroupAuditLog })));
const GroupEvents = lazy(() => import("./GroupEvents").then((module) => ({ default: module.GroupEvents })));
const GroupForms = lazy(() => import("./GroupForms").then((module) => ({ default: module.GroupForms })));
const GroupMailingLists = lazy(() =>
  import("./GroupMailingLists").then((module) => ({ default: module.GroupMailingLists })),
);
const GroupVotes = lazy(() => import("./GroupVotes").then((module) => ({ default: module.GroupVotes })));
const GroupOverview = lazy(() => import("./GroupOverview").then((module) => ({ default: module.GroupOverview })));
const GroupStatistics = lazy(() => import("./GroupStatistics").then((module) => ({ default: module.GroupStatistics })));

const OVERVIEW_VIEW = "overview";

function GroupContextHeader({ group }: { group: AuthenticatedGroup }) {
  return (
    <div class="portal-management-context card border-0 shadow-sm">
      <div class="card-body d-flex flex-wrap align-items-start justify-content-between gap-3">
        <div>
          <div class="d-flex flex-wrap align-items-center gap-2">
            <h4 class="portal-context-title mb-0">{group.name}</h4>
            <span class="badge text-bg-secondary">{group.type.singularLabel}</span>
            {!group.active && <Badge status="inactive" />}
          </div>
          {group.parentGroup && <p class="text-muted small mb-0 mt-1">Part of {group.parentGroup.name}</p>}
        </div>
        <dl class="d-flex flex-wrap gap-4 mb-0 small">
          <div>
            <dt>People</dt>
            <dd class="mb-0">{group.participantCount}</dd>
          </div>
          <div>
            <dt>Members represented</dt>
            <dd class="mb-0">{group.representedMemberCount}</dd>
          </div>
          <div>
            <dt>Subgroups</dt>
            <dd class="mb-0">{group.childCount}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}

/**
 * Join from the group itself: the same capacity-aware participation card the
 * catalog uses, fetched for exactly this group. Renders nothing while the
 * viewer already participates or holds no member capacity.
 */
function GroupJoinPanel({ groupId, onChanged }: { groupId: string; onChanged: () => void | Promise<void> }) {
  const selfGroup = useData(
    () =>
      getJson(
        `/api/v1/users/current/groups?view=catalog&id=${encodeURIComponent(groupId)}&limit=1`,
        selfGroupsListResponseSchema,
      ),
    [groupId],
  );
  const row = selfGroup.data?.groups[0];
  if (!row || row.eligibleCapacities.length === 0) return null;
  return (
    <GroupParticipationCard
      group={row}
      onChanged={async () => {
        refreshPortalSidebarGroups();
        await selfGroup.reload();
        await onChanged();
      }}
    />
  );
}

export function GroupWorkspace({
  groupId,
  view = OVERVIEW_VIEW,
  resourceId,
  resourceTab,
  resourceDetailId,
}: {
  groupId: string;
  view?: string;
  resourceId?: string;
  /** A second URL segment below `resourceId`: the events, forms, and meetings views forward it as the resource's initial tab. */
  resourceTab?: string;
  /** A third URL segment: the events view forwards it as the tab's own resource (a registration or proposal id, or a promoters sub-tab). */
  resourceDetailId?: string;
}) {
  const detail = useData(
    () => getJson(`/api/v1/groups/${encodeURIComponent(groupId)}`, authenticatedGroupDetailResponseSchema),
    [groupId],
  );
  // While a different group loads, useData still holds the previous group's
  // data; rendering it would leave the old workspace on screen with no
  // feedback. Treat it as absent so the switch shows a spinner immediately.
  const group = detail.data?.group.id === groupId ? detail.data.group : undefined;
  const capabilities = detail.data?.capabilities ?? ([] as GroupCapability[]);
  const views = groupContextNavigation(capabilities);
  const canManage = capabilities.includes("manage");
  const canParticipate = capabilities.includes("participate");
  const settingsGroup: GroupSettingsDetail | null =
    group && detail.data?.configuration ? { ...group, ...detail.data.configuration } : null;

  return (
    <div class="d-flex flex-column gap-3">
      {detail.loading && !group && <Spinner label="Loading group…" />}
      {detail.error && <ErrorAlert error={detail.error} />}
      {group && (
        <>
          <GroupContextHeader group={group} />
          {/* Tab targets derive from the route's groupId, never from fetched
              data: while another group's data is in flight, links must not
              point back into the group being left. */}
          <nav class="nav nav-tabs" aria-label={`${group.name} sections`}>
            {views.map((item) => (
              <Link
                key={item.key}
                href={`/groups/${encodeURIComponent(groupId)}/${item.key}`}
                class={`nav-link${view === item.key ? " active" : ""}`}
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <Suspense fallback={<Spinner />}>
            {view === OVERVIEW_VIEW && (
              <>
                {!canParticipate && Boolean(portalSession.value?.member) && (
                  <GroupJoinPanel groupId={group.id} onChanged={detail.reload} />
                )}
                <GroupOverview groupId={group.id} description={group.description} />
                {canParticipate && (
                  <p class="text-muted small mb-0">
                    You participate in this group. <Link href="/groups">Manage your participation</Link>
                  </p>
                )}
              </>
            )}
            {view === "settings" && canManage && settingsGroup && (
              <div class="d-flex flex-column gap-3">
                <GroupSettingsForm group={settingsGroup} onUpdated={detail.reload} />
                <GroupCategoryRulesEditor groupId={group.id} onUpdated={detail.reload} />
              </div>
            )}
            {view === "members" && (canManage || canParticipate) && (
              <GroupMembers key={group.id} groupId={group.id} canManage={canManage} onChanged={detail.reload} />
            )}
            {view === "leadership" && canManage && <GroupLeadership key={group.id} groupId={group.id} />}
            {view === "events" && (
              <GroupEvents
                key={`${group.id}:${resourceId ?? ""}`}
                groupId={group.id}
                canManage={canManage}
                initialEventId={resourceId}
                initialEventTab={resourceTab}
                initialEventDetailId={resourceDetailId}
              />
            )}
            {view === "meetings" && (
              <GroupMeetings
                key={`${group.id}:${resourceId ?? ""}`}
                groupId={group.id}
                canManage={canManage}
                initialSeriesId={resourceId}
                initialSeriesTab={resourceTab}
              />
            )}
            {view === "forms" && (
              <GroupForms
                key={`${group.id}:${resourceId ?? ""}`}
                groupId={group.id}
                canManage={canManage}
                initialPlacementId={resourceId}
                initialPlacementTab={resourceTab}
              />
            )}
            {view === "votes" && (
              <GroupVotes
                key={`${group.id}:${resourceId ?? ""}`}
                groupId={group.id}
                canManage={canManage}
                canParticipate={canParticipate}
                initialVoteId={resourceId}
              />
            )}
            {view === "stats" && canManage && <GroupStatistics key={group.id} groupId={group.id} />}
            {view === "mailing-lists" && (
              <GroupMailingLists
                key={group.id}
                groupId={group.id}
                canManage={canManage}
                canParticipate={canParticipate}
              />
            )}
            {view === "audit" && canManage && <GroupAuditLog key={group.id} groupId={group.id} />}
          </Suspense>
          {!views.some((item) => item.key === view) && (
            <ErrorAlert error="This group section is not available to your current identity." />
          )}
        </>
      )}
    </div>
  );
}
