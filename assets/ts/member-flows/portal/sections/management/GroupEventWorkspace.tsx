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
import { Button, ButtonLink } from "../../../../ui/Button";
import { Panel, PanelBody } from "../../../../ui/Panel";
import { formatEventWhen } from "../../ui";
import { EventStats } from "../events/detail/EventStats";
import { Promoters } from "../events/detail/Promoters";
import { Team } from "../events/detail/Team";
import { ProposalDetailPage } from "../events/detail/ProposalDetailPage";
import { RegistrationDetailPage } from "../events/detail/RegistrationDetailPage";
import { GroupEventCommunications } from "./GroupEventCommunications";
import { GroupEventConfiguration } from "./GroupEventConfiguration";
import { GroupEventEditor } from "./GroupEventEditor";
import { GroupEventInvitations } from "./GroupEventInvitations";
import { GroupEventProposals } from "./GroupEventProposals";
import { GroupEventRegistrationPanel } from "./GroupEventRegistrationPanel";
import { GroupEventRegistrations } from "./GroupEventRegistrations";
import { ResourceSharingEditor } from "./ResourceSharingEditor";
// `pk-datalist` on the overview metadata is defined in Content.css, which ships
// in a lazy chunk rather than in the entry stylesheet.
import "../../../../ui/Content.css";

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
  { key: "team", label: "Team", visible: (event) => event.capabilities.includes("manage") },
  // "manage_attendance" is the lowest manager-tier capability for a group event — the same tier
  // that gates Registrations — mirroring the "read" capability that gates Promoters and Analytics
  // on the standalone event detail view (its lowest staff-facing tier, not the plain-viewer tier).
  { key: "promoters", label: "Promoters", visible: (event) => event.capabilities.includes("manage_attendance") },
  { key: "stats", label: "Analytics", visible: (event) => event.capabilities.includes("manage_attendance") },
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
  detailId,
  onUpdated,
}: {
  event: GroupEvent;
  groupId: string;
  /** The URL-addressed tab segment, if any. Undefined selects the default tab. */
  tab?: string;
  /** A URL-addressed resource inside the tab: a registration or proposal id, or a promoters sub-tab. */
  detailId?: string;
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
    <section class="pk pk-stack" aria-label={`${event.name} workspace`}>
      <div class="pk-stack pk-stack--tight">
        <div class="pk-cluster">
          <Button variant="link" size="sm" onClick={() => navigate(`/groups/${encodeURIComponent(groupId)}/events`)}>
            ← Back to events
          </Button>
        </div>
        {/* h3: the shell owns h1 and the workspace's PageHeader owns h2, so a
          record inside a workspace tab is the next level down. */}
        <h3 class="pk-record-title">{event.name}</h3>
        <p class="pk-small">
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
        <section aria-label={`${activeTabLabel} — ${event.name}`} class="pk-stack">
          {activeTab === GROUP_EVENT_OVERVIEW_TAB && (
            <>
              <dl class="pk-datalist pk-small">
                <dt>When</dt>
                <dd>{formatEventWhen(event.nextOccurrenceAt ?? event.startsAt, event.timezone, event.location)}</dd>
                {event.endsAt && (
                  <>
                    <dt>Ends</dt>
                    {/* The same formatter as "When": one page must not show
                        the start in the event's zone and the end in the
                        viewer's. */}
                    <dd>{formatEventWhen(event.endsAt, event.timezone, event.location)}</dd>
                  </>
                )}
                <dt>Profile</dt>
                <dd>
                  <Badge status={event.profileKey ?? "event"} />
                </dd>
                <dt>Registration</dt>
                <dd>{label(event.registrationPolicy)}</dd>
                {event.location && (
                  <>
                    <dt>Location</dt>
                    <dd>{event.location}</dd>
                  </>
                )}
              </dl>

              {event.links.length > 0 && (
                <div class="pk-stack pk-stack--tight">
                  <h3 class="pk-small pk-strong">Event links</h3>
                  {/* Each item is a cluster, which blockifies the `li` and so
                      drops the marker the base layer restores — the same way
                      the other migrated portal lists carry their rows. */}
                  <ul class="pk-stack pk-stack--tight" aria-label="Event links">
                    {event.links.map((url) => (
                      <li key={url} class="pk-cluster">
                        <a href={url} target="_blank" rel="noopener noreferrer">
                          {getLinkLabel(url)}
                          <span class="pk-sr-only"> (opens in a new tab)</span>
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {canRegister && <GroupEventRegistrationPanel event={event} groupId={groupId} />}
            </>
          )}

          {activeTab === "registrations" &&
            (detailId ? (
              <RegistrationDetailPage
                slug={event.slug}
                regId={detailId}
                onBack={() => navigate(tabPath("registrations"))}
              />
            ) : (
              <GroupEventRegistrations groupId={groupId} eventId={event.id} canVip={canManage} />
            ))}

          {activeTab === "proposals" &&
            (detailId ? (
              <ProposalDetailPage
                slug={event.slug}
                proposalId={detailId}
                contextLabel={event.name}
                onBack={() => navigate(tabPath("proposals"))}
              />
            ) : (
              <GroupEventProposals
                groupId={groupId}
                eventId={event.id}
                eventSlug={event.slug}
                proposalPathFor={(proposalId) => `${tabPath("proposals")}/${encodeURIComponent(proposalId)}`}
              />
            ))}

          {activeTab === "invitations" && (
            <>
              {canManage && <GroupEventInvitations groupId={groupId} event={event} />}
              {canFinalizeProposals && <GroupEventInvitations groupId={groupId} event={event} inviteType="speaker" />}
            </>
          )}

          {activeTab === "communications" && <GroupEventCommunications groupId={groupId} eventId={event.id} />}

          {activeTab === "team" && <Team slug={event.slug} />}

          {activeTab === "promoters" && <Promoters slug={event.slug} subTab={detailId} />}

          {activeTab === "stats" && <EventStats slug={event.slug} />}

          {activeTab === "settings" && (
            <>
              {!event.seriesId && <GroupEventConfiguration event={event} groupId={groupId} onUpdated={onUpdated} />}

              {/* The separating rule the Bootstrap version drew with a
                  `border-top` is the panel's own edge here, and the panel is
                  only drawn when it has something in it: an event that is
                  neither standalone nor part of a series offers neither
                  control, and an empty rule across the page said nothing. */}
              {(isStandaloneEvent(event) || event.seriesId !== null) && (
                <Panel>
                  <PanelBody class="pk-stack">
                    {isStandaloneEvent(event) && editing ? (
                      <>
                        <h3>Edit event</h3>
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
                      <div class="pk-cluster">
                        {isStandaloneEvent(event) && (
                          <Button variant="primary" size="sm" onClick={() => setEditing(true)}>
                            Edit event
                          </Button>
                        )}
                        {/* Going to the meeting series is navigation, not an
                            action, so it stays an anchor and borrows the
                            button's appearance rather than its element. */}
                        {event.seriesId && (
                          <ButtonLink size="sm" href={`#/groups/${encodeURIComponent(groupId)}/meetings`}>
                            Manage meeting series
                          </ButtonLink>
                        )}
                      </div>
                    )}
                  </PanelBody>
                </Panel>
              )}

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
