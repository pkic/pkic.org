import { useCallback } from "preact/hooks";
import { Link } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import {
  groupPortalContextResponseSchema,
  type Group,
  type GroupPortalCapability,
} from "../../../../../shared/schemas/groups";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { ServerSearchSelect } from "../../../../components/ServerSearchSelect";
import { Spinner } from "../../../../components/Spinner";
import { useData } from "../../../../hooks/useData";
import { getJson } from "../../../../shared/api-client";
import { managedGroupCatalog } from "./catalog";
import { GroupSettingsForm } from "./GroupSettingsForm";
import { GroupCreateForm } from "./GroupCreateForm";
import { GroupCategoryRulesEditor } from "./GroupCategoryRulesEditor";
import { GroupMembers } from "./GroupMembers";
import { GroupLeadership } from "./GroupLeadership";
import { GroupMeetings } from "./GroupMeetings";
import { GroupAuditLog } from "./GroupAuditLog";
import { GroupEvents } from "./GroupEvents";
import { GroupForms } from "./GroupForms";
import { GroupMailingLists } from "./GroupMailingLists";
import { GroupVotes } from "./GroupVotes";
import { GroupStatistics } from "./GroupStatistics";
import { ProposalPrograms } from "./ProposalPrograms";
import { groupContextNavigation } from "./group-context-navigation";

const OVERVIEW_VIEW = "overview";

/** Prevents a delayed selector response from overriding navigation to another portal section. */
export function managementRouteOwnsHash(groupId: string | undefined, hash: string): boolean {
  const path = hash.replace(/^#/, "").split("?", 1)[0].replace(/\/$/, "");
  if (!groupId) return path === "/management";
  const groupPath = `/groups/${encodeURIComponent(groupId)}`;
  return path === groupPath || path.startsWith(`${groupPath}/`);
}

function GroupContextHeader({ group }: { group: Group }) {
  return (
    <div class="portal-management-context card border-0 shadow-sm">
      <div class="card-body d-flex flex-wrap align-items-start justify-content-between gap-3">
        <div>
          <div class="d-flex flex-wrap align-items-center gap-2">
            <h5 class="mb-0">{group.name}</h5>
            <span class="badge text-bg-secondary">{group.type.singularLabel}</span>
            {!group.active && <span class="badge text-bg-warning">Inactive</span>}
          </div>
          {group.parentGroup && <p class="text-muted small mb-0 mt-1">Part of {group.parentGroup.name}</p>}
        </div>
        <dl class="d-flex flex-wrap gap-4 mb-0 small">
          <div>
            <dt>People</dt>
            <dd class="mb-0">{group.participantCount}</dd>
          </div>
          <div>
            <dt>Membership capacities</dt>
            <dd class="mb-0">{group.membershipCapacityCount}</dd>
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

export function Management({
  groupId,
  view = OVERVIEW_VIEW,
  resourceId,
}: {
  groupId?: string;
  view?: string;
  resourceId?: string;
}) {
  const [, navigate] = useHashLocation();
  const selectGroup = useCallback(
    (group: Group | null) => {
      if (!managementRouteOwnsHash(groupId, window.location.hash)) return;
      navigate(group ? `/groups/${encodeURIComponent(group.id)}/${OVERVIEW_VIEW}` : "/management");
    },
    [groupId, navigate],
  );
  const detail = useData(
    () =>
      groupId
        ? getJson(`/api/v1/groups/${encodeURIComponent(groupId)}/context`, groupPortalContextResponseSchema)
        : Promise.resolve(null),
    [groupId],
  );
  const group = detail.data?.group;
  const capabilities = detail.data?.capabilities ?? ([] as GroupPortalCapability[]);
  const views = groupContextNavigation(capabilities);
  const canManage = capabilities.includes("manage");

  return (
    <div class="d-flex flex-column gap-3">
      {(!groupId || canManage) && (
        <div class="portal-management-picker">
          <ServerSearchSelect
            catalog={managedGroupCatalog}
            label="Managed group"
            value={groupId ?? null}
            selectedLabel={group?.name}
            allowEmpty={false}
            autoSelectFirst={!groupId}
            onChange={selectGroup}
          />
        </div>
      )}

      {!groupId && (
        <>
          <p class="text-muted mb-0">Select a group to manage its resources and participation.</p>
          <ProposalPrograms />
          <GroupCreateForm onCreated={(created) => navigate(`/groups/${encodeURIComponent(created.id)}/settings`)} />
        </>
      )}
      {groupId && detail.loading && <Spinner />}
      {groupId && detail.error && <ErrorAlert error={detail.error} />}
      {group && (
        <>
          <GroupContextHeader group={group} />
          <nav class="nav nav-tabs" aria-label={`${group.name} sections`}>
            {views.map((item) => (
              <Link
                key={item.key}
                href={`/groups/${encodeURIComponent(group.id)}/${item.key}`}
                class={`nav-link${view === item.key ? " active" : ""}`}
              >
                {item.label}
              </Link>
            ))}
          </nav>
          {view === OVERVIEW_VIEW && (
            <div class="card border-0 shadow-sm">
              <div class="card-header bg-white fw-semibold">About this group</div>
              <div class="card-body">
                <p class="mb-0">{group.description || "No group description has been provided."}</p>
              </div>
            </div>
          )}
          {view === "settings" && canManage && (
            <div class="d-flex flex-column gap-3">
              <GroupSettingsForm group={group} onUpdated={detail.reload} />
              <GroupCategoryRulesEditor groupId={group.id} onUpdated={detail.reload} />
            </div>
          )}
          {view === "members" && canManage && (
            <GroupMembers key={group.id} groupId={group.id} onChanged={detail.reload} />
          )}
          {view === "leadership" && canManage && <GroupLeadership key={group.id} groupId={group.id} />}
          {view === "events" && <GroupEvents key={group.id} groupId={group.id} canManage={canManage} />}
          {view === "meetings" && <GroupMeetings key={group.id} groupId={group.id} canManage={canManage} />}
          {view === "forms" && <GroupForms key={group.id} groupId={group.id} canManage={canManage} />}
          {view === "votes" && (
            <GroupVotes
              key={`${group.id}:${resourceId ?? ""}`}
              groupId={group.id}
              canManage={canManage}
              canParticipate={capabilities.includes("participate")}
              initialVoteId={resourceId}
            />
          )}
          {view === "stats" && canManage && <GroupStatistics key={group.id} groupId={group.id} />}
          {view === "mailing-lists" && (
            <GroupMailingLists
              key={group.id}
              groupId={group.id}
              canManage={canManage}
              canParticipate={capabilities.includes("participate")}
            />
          )}
          {view === "audit" && canManage && <GroupAuditLog key={group.id} groupId={group.id} />}
          {!views.some((item) => item.key === view) && (
            <ErrorAlert error="This group section is not available to your current identity." />
          )}
        </>
      )}
    </div>
  );
}
