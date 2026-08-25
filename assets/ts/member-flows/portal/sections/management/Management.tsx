import { useCallback } from "preact/hooks";
import { Link } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { groupResponseSchema, type Group } from "../../../../../shared/schemas/groups";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { ServerSearchSelect } from "../../../../components/ServerSearchSelect";
import { Spinner } from "../../../../components/Spinner";
import { useData } from "../../../../hooks/useData";
import { getJson } from "../../../../shared/api-client";
import { managedGroupCatalog } from "./catalog";
import { GroupSettingsForm } from "./GroupSettingsForm";
import { GroupMembers } from "./GroupMembers";
import { GroupLeadership } from "./GroupLeadership";
import { GroupMeetings } from "./GroupMeetings";

const OVERVIEW_VIEW = "overview";
const MANAGEMENT_VIEWS = [
  { key: OVERVIEW_VIEW, label: "Overview and settings" },
  { key: "members", label: "Members" },
  { key: "leadership", label: "Leadership" },
  { key: "meetings", label: "Meetings" },
] as const;

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

export function Management({ groupId, view = OVERVIEW_VIEW }: { groupId?: string; view?: string }) {
  const [, navigate] = useHashLocation();
  const selectGroup = useCallback(
    (group: Group | null) => {
      navigate(group ? `/management/${encodeURIComponent(group.id)}/${OVERVIEW_VIEW}` : "/management");
    },
    [navigate],
  );
  const detail = useData(
    () =>
      groupId
        ? getJson(`/api/v1/groups/${encodeURIComponent(groupId)}?manageable=true`, groupResponseSchema)
        : Promise.resolve(null),
    [groupId],
  );
  const group = detail.data?.group;

  return (
    <div class="d-flex flex-column gap-3">
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

      {!groupId && <p class="text-muted mb-0">Select a group to manage its resources and participation.</p>}
      {groupId && detail.loading && <Spinner />}
      {groupId && detail.error && <ErrorAlert error={detail.error} />}
      {group && (
        <>
          <GroupContextHeader group={group} />
          <nav class="nav nav-tabs" aria-label={`${group.name} management`}>
            {MANAGEMENT_VIEWS.map((item) => (
              <Link
                key={item.key}
                href={`/management/${encodeURIComponent(group.id)}/${item.key}`}
                class={`nav-link${view === item.key ? " active" : ""}`}
              >
                {item.label}
              </Link>
            ))}
          </nav>
          {view === OVERVIEW_VIEW && <GroupSettingsForm group={group} onUpdated={detail.reload} />}
          {view === "members" && <GroupMembers key={group.id} groupId={group.id} onChanged={detail.reload} />}
          {view === "leadership" && <GroupLeadership key={group.id} groupId={group.id} />}
          {view === "meetings" && <GroupMeetings key={group.id} groupId={group.id} />}
          {!MANAGEMENT_VIEWS.some((item) => item.key === view) && (
            <ErrorAlert error="This group-management section does not exist." />
          )}
        </>
      )}
    </div>
  );
}
