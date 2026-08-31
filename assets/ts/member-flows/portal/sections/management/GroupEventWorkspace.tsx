/**
 * URL-addressed dashboard for one group-managed event. Replaces the events
 * table when an event is selected: a "Back to events" link, a header, and
 * capability-filtered tabs, each rendering the same child components the
 * event previously stacked into one long detail row.
 */
import { useState } from "preact/hooks";
import { usePortalHashLocation } from "../../hash-location";
import type { GroupEvent } from "../../../../../shared/schemas/group-events";
import { getLinkLabel } from "../../../../../shared/schemas/links";
import { Badge } from "../../../../components/Badge";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { Tabs, type TabItem } from "../../../../components/Tabs";
import { fmt, formatEventWhen } from "../../ui";
import { GroupEventCommunications } from "./GroupEventCommunications";
import { GroupEventConfiguration } from "./GroupEventConfiguration";
import { GroupEventEditor } from "./GroupEventEditor";
import { GroupEventInvitations } from "./GroupEventInvitations";
import { GroupEventProposals } from "./GroupEventProposals";
import { GroupEventRegistrationPanel } from "./GroupEventRegistrationPanel";
import { GroupEventRegistrations } from "./GroupEventRegistrations";
import { ResourceSharingEditor } from "./ResourceSharingEditor";

function label(value: string): string {
  return value.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}

function isStandaloneEvent(event: Pick<GroupEvent, "seriesId" | "profileKey">): boolean {
  return event.seriesId === null && event.profileKey !== "meeting" && event.profileKey !== "board_meeting";
}

interface EventWorkspaceTabDef extends TabItem {
  visible: (event: GroupEvent) => boolean;
}

export const GROUP_EVENT_OVERVIEW_TAB = "overview";

const EVENT_WORKSPACE_TABS: readonly EventWorkspaceTabDef[] = [
  { key: GROUP_EVENT_OVERVIEW_TAB, label: "Overview", visible: () => true },
  {
    key: "registrations",
    label: "Registrations",
    visible: (event) => event.capabilities.includes("manage_attendance"),
  },
  { key: "proposals", label: "Proposals", visible: (event) => event.proposalAccess?.canRead === true },
  {
    key: "invitations",
    label: "Invitations",
    visible: (event) => event.capabilities.includes("manage") || event.proposalAccess?.canFinalize === true,
  },
  { key: "communications", label: "Communications", visible: (event) => event.capabilities.includes("manage") },
  { key: "settings", label: "Settings", visible: (event) => event.capabilities.includes("manage") },
];

export function visibleEventWorkspaceTabs(event: GroupEvent): TabItem[] {
  return EVENT_WORKSPACE_TABS.filter((tab) => tab.visible(event)).map(({ key, label: tabLabel }) => ({
    key,
    label: tabLabel,
  }));
}

export function GroupEventWorkspace({
  event,
  groupId,
  tab,
  onUpdated,
}: {
  event: GroupEvent;
  groupId: string;
  /** The URL-addressed tab segment, if any. Undefined selects the default tab. */
  tab?: string;
  onUpdated?: () => void | Promise<void>;
}) {
  const [, navigate] = usePortalHashLocation();
  const [editing, setEditing] = useState(false);
  const canManage = event.capabilities.includes("manage");
  const canRegister = event.registrationPolicy !== "no_registration" && event.capabilities.includes("register");
  const canFinalizeProposals = event.proposalAccess?.canFinalize === true;
  const visibleTabs = visibleEventWorkspaceTabs(event);
  const isKnownTab = tab !== undefined && EVENT_WORKSPACE_TABS.some((item) => item.key === tab);
  const isVisibleTab = tab !== undefined && visibleTabs.some((item) => item.key === tab);
  // An unrecognized tab key falls back to the default tab; a recognized tab
  // the identity's capabilities do not currently grant renders as unavailable
  // instead of silently switching away from what was requested.
  const activeTab = isKnownTab && tab !== undefined ? tab : (visibleTabs[0]?.key ?? GROUP_EVENT_OVERVIEW_TAB);
  const showUnavailable = isKnownTab && !isVisibleTab;
  const activeTabLabel = EVENT_WORKSPACE_TABS.find((item) => item.key === activeTab)?.label ?? activeTab;

  function tabPath(nextTab: string): string {
    const base = `/groups/${encodeURIComponent(groupId)}/events/${encodeURIComponent(event.id)}`;
    return nextTab === GROUP_EVENT_OVERVIEW_TAB ? base : `${base}/${nextTab}`;
  }

  function goToTab(nextTab: string): void {
    navigate(tabPath(nextTab));
  }

  return (
    <section class="d-flex flex-column gap-3" aria-label={`${event.name} workspace`}>
      <div>
        <button
          type="button"
          class="btn btn-link btn-sm ps-0 mb-2"
          onClick={() => navigate(`/groups/${encodeURIComponent(groupId)}/events`)}
        >
          ← Back to events
        </button>
        <h5 class="mb-1">{event.name}</h5>
        <p class="small text-muted mb-0">{event.slug}</p>
        <p class="small text-muted mb-0">
          {formatEventWhen(event.nextOccurrenceAt ?? event.startsAt, event.timezone, event.location)}
          {event.location ? ` · ${event.location}` : ""}
        </p>
      </div>

      <Tabs
        items={visibleTabs}
        active={activeTab}
        onChange={goToTab}
        hrefFor={tabPath}
        idPrefix={`group-event-${event.id}`}
      />

      {showUnavailable ? (
        <ErrorAlert error="This event section is not available to your current identity." />
      ) : (
        <section aria-label={`${activeTabLabel} — ${event.name}`} class="d-flex flex-column gap-3">
          {activeTab === GROUP_EVENT_OVERVIEW_TAB && (
            <>
              <dl class="row mb-0 small">
                <dt class="col-sm-3">When</dt>
                <dd class="col-sm-9">
                  {formatEventWhen(event.nextOccurrenceAt ?? event.startsAt, event.timezone, event.location)}
                </dd>
                {event.endsAt && (
                  <>
                    <dt class="col-sm-3">Ends</dt>
                    <dd class="col-sm-9">{fmt(event.endsAt)}</dd>
                  </>
                )}
                <dt class="col-sm-3">Profile</dt>
                <dd class="col-sm-9">
                  <Badge status={event.profileKey ?? "event"} />
                </dd>
                <dt class="col-sm-3">Registration</dt>
                <dd class="col-sm-9">{label(event.registrationPolicy)}</dd>
                {event.location && (
                  <>
                    <dt class="col-sm-3">Location</dt>
                    <dd class="col-sm-9">{event.location}</dd>
                  </>
                )}
              </dl>

              {event.links.length > 0 && (
                <div>
                  <h6 class="small fw-semibold">Event links</h6>
                  <ul class="list-unstyled mb-0 d-flex flex-column gap-1">
                    {event.links.map((url) => (
                      <li key={url}>
                        <a href={url} target="_blank" rel="noopener noreferrer">
                          {getLinkLabel(url)}
                          <span class="visually-hidden"> (opens in a new tab)</span>
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {canRegister && <GroupEventRegistrationPanel event={event} groupId={groupId} />}
            </>
          )}

          {activeTab === "registrations" && (
            <GroupEventRegistrations groupId={groupId} eventId={event.id} canVip={canManage} />
          )}

          {activeTab === "proposals" && (
            <GroupEventProposals groupId={groupId} eventId={event.id} eventSlug={event.slug} />
          )}

          {activeTab === "invitations" && (
            <>
              {canManage && <GroupEventInvitations groupId={groupId} event={event} />}
              {canFinalizeProposals && <GroupEventInvitations groupId={groupId} event={event} inviteType="speaker" />}
            </>
          )}

          {activeTab === "communications" && <GroupEventCommunications groupId={groupId} eventId={event.id} />}

          {activeTab === "settings" && (
            <>
              {!event.seriesId && <GroupEventConfiguration event={event} groupId={groupId} onUpdated={onUpdated} />}

              <div class="border-top pt-3">
                {isStandaloneEvent(event) && editing ? (
                  <>
                    <h6>Edit event</h6>
                    <GroupEventEditor
                      groupId={groupId}
                      event={event}
                      onSaved={async () => {
                        setEditing(false);
                        await onUpdated?.();
                      }}
                      onCancel={() => setEditing(false)}
                    />
                  </>
                ) : (
                  <div class="d-flex align-items-center gap-2">
                    {isStandaloneEvent(event) && (
                      <button type="button" class="btn btn-sm btn-primary" onClick={() => setEditing(true)}>
                        Edit event
                      </button>
                    )}
                    {event.seriesId && (
                      <a
                        class="btn btn-sm btn-outline-secondary"
                        href={`#/groups/${encodeURIComponent(groupId)}/meetings`}
                      >
                        Manage meeting series
                      </a>
                    )}
                  </div>
                )}
              </div>

              {event.ownerGroupId === groupId && (
                <ResourceSharingEditor
                  kind="event"
                  groupId={groupId}
                  resourceId={event.id}
                  ownerGroupId={event.ownerGroupId}
                />
              )}
            </>
          )}
        </section>
      )}
    </section>
  );
}
