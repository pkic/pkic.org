/**
 * URL-addressed record page for one group-managed event.
 *
 * The event is a record inside the group workspace: its own header under the
 * group's, capability-filtered tabs, and inside two of those tabs — the
 * registrations and the proposals — records of its own, each a routed page
 * with its own address. Nothing opens between the rows of a list.
 */
import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import { usePortalHashLocation } from "../../hash-location";
import type { GroupEvent } from "../../../../../shared/schemas/group-events";
import type { EventFormsPurpose } from "../../../../../shared/schemas/forms";
import {
  EVENT_PROFILE_LABELS,
  EVENT_REGISTRATION_POLICY_LABELS,
  EVENT_SOURCE_MODE_LABELS,
  EVENT_VISIBILITY_LABELS,
} from "../../../../../shared/schemas/event-series";
import { Badge } from "../../../../components/Badge";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { Tabs, type TabItem } from "../../../../components/Tabs";
import { BreadcrumbBranch } from "../../../../ui/BreadcrumbScope";
import { ButtonLink } from "../../../../ui/Button";
import { DescriptionList } from "../../../../ui/DescriptionList";
import { LinkList } from "../../../../ui/LinkList";
import { Menu } from "../../../../ui/Menu";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
import { ProfileHeader } from "../../../../ui/ProfileHeader";
import { formatEventWhen } from "../../ui";
import { EventStats } from "../events/detail/EventStats";
import { Promoters } from "../events/detail/Promoters";
import { Team } from "../events/detail/Team";
import { ProposalDetailPage } from "../events/detail/ProposalDetailPage";
import { LazySponsorTiersTab } from "../events/detail/settings/LazySponsorTiersTab";
import { EventFormResponses } from "../../../../components/forms/management/FormManagement";
import { GroupEventCommunications, NEW_CAMPAIGN_SEGMENT } from "./GroupEventCommunications";
import { LazyGroupEventConfiguration } from "./LazyGroupEventConfiguration";
import { GroupEventEditor } from "./GroupEventEditor";
import { GroupEventInvitations } from "./GroupEventInvitations";
import { GroupEventProposals } from "./GroupEventProposals";
import { GroupEventRegistrationPanel } from "./GroupEventRegistrationPanel";
import { GroupEventRegistrationRecord } from "./GroupEventRegistrationRecord";
import { GroupEventRegistrations } from "./GroupEventRegistrations";
import { ResourceSharingEditor } from "./ResourceSharingEditor";
// `pk-datalist-aligned` and `pk-mono` ship in Content.css, a lazy chunk
// rather than the entry stylesheet.
import "../../../../ui/Content.css";

function isStandaloneEvent(event: Pick<GroupEvent, "seriesId" | "profileKey">): boolean {
  return event.seriesId === null && event.profileKey !== "meeting" && event.profileKey !== "board_meeting";
}

interface EventWorkspaceTabDef extends TabItem {
  visible: (event: GroupEvent) => boolean;
}

export const GROUP_EVENT_OVERVIEW_TAB = "overview";
const EVENT_RESPONSES_SEGMENT = "responses";

function EventRecordSections({
  label,
  basePath,
  responsesActive,
  eventSlug,
  purpose,
  children,
}: {
  label: string;
  basePath: string;
  responsesActive: boolean;
  eventSlug: string;
  purpose: EventFormsPurpose;
  children: ComponentChildren;
}) {
  const active = responsesActive ? EVENT_RESPONSES_SEGMENT : "overview";
  return (
    <div class="pk pk-stack">
      <Tabs
        label={`${label} sections`}
        items={[
          { key: "overview", label: "Overview" },
          { key: EVENT_RESPONSES_SEGMENT, label: "Responses" },
        ]}
        active={active}
        hrefFor={(key) => (key === "overview" ? basePath : `${basePath}/${EVENT_RESPONSES_SEGMENT}`)}
      />
      {responsesActive ? <EventFormResponses eventSlug={eventSlug} purpose={purpose} /> : children}
    </div>
  );
}

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

/** The invitation audiences, each a routed sub-view of the Invitations tab. */
const INVITATION_AUDIENCES = [
  { key: "attendees", label: "Attendees", inviteType: "attendee" as const },
  { key: "speakers", label: "Speakers", inviteType: "speaker" as const },
] as const;

export function GroupEventWorkspace({
  event,
  groupId,
  tab,
  detailId,
  detailTab,
  detailSegment,
  onUpdated,
}: {
  event: GroupEvent;
  groupId: string;
  /** The URL-addressed tab segment, if any. Undefined selects the default tab. */
  tab?: string;
  /** A URL-addressed resource inside the tab: a registration or proposal id, an invitation audience, or a promoters sub-tab. */
  detailId?: string;
  /** The facet of that resource: a proposal's own tab, or the composer page under an invitation audience. */
  detailTab?: string;
  /** A page under that facet: the co-speaker invitation under a proposal's Speakers. */
  detailSegment?: string;
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
  const standalone = isStandaloneEvent(event);

  function tabPath(nextTab: string): string {
    const base = `/groups/${encodeURIComponent(groupId)}/events/${encodeURIComponent(event.id)}`;
    return nextTab === GROUP_EVENT_OVERVIEW_TAB ? base : `${base}/${nextTab}`;
  }

  function goToTab(nextTab: string): void {
    navigate(tabPath(nextTab));
  }

  // The audiences this identity may invite. Attendees need event management;
  // speakers need the proposal program's finalize authority.
  const invitationAudiences = INVITATION_AUDIENCES.filter((audience) =>
    audience.inviteType === "attendee" ? canManage : canFinalizeProposals,
  );
  // `…/invitations` is the first audience; `…/invitations/speakers` the second.
  // Under either, `new` opens the composer page.
  const invitationAudience =
    invitationAudiences.find((audience) => audience.key === detailId) ?? invitationAudiences[0];
  const invitationSegment = detailId === "new" ? "new" : detailTab;
  const invitationPath = (key: string) =>
    key === invitationAudiences[0]?.key ? tabPath("invitations") : `${tabPath("invitations")}/${key}`;

  const responsesActive = detailId === EVENT_RESPONSES_SEGMENT;
  const recordOpen =
    detailId !== undefined && !responsesActive && (activeTab === "registrations" || activeTab === "proposals");

  return (
    <BreadcrumbBranch
      items={[
        { label: event.name, href: usePortalHashLocation.hrefs(tabPath("overview")) },
        { label: activeTabLabel, href: usePortalHashLocation.hrefs(tabPath(activeTab)) },
      ]}
    >
      <section class="pk pk-stack" aria-label={`${event.name} workspace`}>
        {/* A record inside the event — a registration, a proposal — carries
            its own header, so the event's steps aside and the tab row alone
            says where in the event the reader is. */}
        {!recordOpen && (
          <ProfileHeader
            headingLevel={3}
            title={event.name}
            context={
              <Badge
                status={event.profileKey ?? "event"}
                label={EVENT_PROFILE_LABELS[event.profileKey ?? "conference"]}
              />
            }
            lede={
              <>
                {formatEventWhen(event.nextOccurrenceAt ?? event.startsAt, event.timezone, event.location)}
                {event.location ? ` · ${event.location}` : ""}
              </>
            }
            facts={[
              EVENT_REGISTRATION_POLICY_LABELS[event.registrationPolicy],
              EVENT_VISIBILITY_LABELS[event.visibility],
            ]}
          />
        )}

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
              <div class="pk-record">
                <div class="pk-stack">
                  {canRegister && <GroupEventRegistrationPanel event={event} groupId={groupId} />}
                </div>
                <aside class="pk-stack pk-datalist-aligned">
                  <Panel aria-label="Schedule">
                    <PanelHeader title="Schedule" />
                    <PanelBody>
                      <DescriptionList
                        items={[
                          { term: "Starts", value: formatEventWhen(event.startsAt, event.timezone, event.location) },
                          /* The same formatter as "Starts": one page must not show
                             the start in the event's zone and the end in the
                             viewer's. */
                          { term: "Ends", value: formatEventWhen(event.endsAt, event.timezone, event.location) },
                          { term: "Time zone", value: event.timezone },
                          { term: "Location", value: event.location },
                        ]}
                      />
                    </PanelBody>
                  </Panel>
                  <Panel aria-label="Event facts">
                    <PanelHeader title="Event" />
                    <PanelBody>
                      <DescriptionList
                        density="compact"
                        items={[
                          { term: "Profile", value: EVENT_PROFILE_LABELS[event.profileKey ?? "conference"] },
                          { term: "Registration", value: EVENT_REGISTRATION_POLICY_LABELS[event.registrationPolicy] },
                          { term: "Visibility", value: EVENT_VISIBILITY_LABELS[event.visibility] },
                          {
                            term: "Source",
                            value: event.sourceMode ? EVENT_SOURCE_MODE_LABELS[event.sourceMode] : undefined,
                          },
                          { term: "Slug", value: <span class="pk-mono">{event.slug}</span> },
                        ]}
                      />
                    </PanelBody>
                  </Panel>
                  {/* Absent rather than empty when the event has stated no
                      links: a titled panel with nothing in it claims a fact
                      the record does not have. */}
                  {event.links.length > 0 && (
                    <Panel aria-label="Event links">
                      <PanelHeader title="Links" />
                      <PanelBody>
                        <LinkList links={event.links} label="Event links" />
                      </PanelBody>
                    </Panel>
                  )}
                </aside>
              </div>
            )}

            {activeTab === "registrations" &&
              (recordOpen && detailId ? (
                <GroupEventRegistrationRecord
                  key={detailId}
                  groupId={groupId}
                  eventId={event.id}
                  registrationId={detailId}
                  canVip={canManage}
                />
              ) : (
                <EventRecordSections
                  label="Registration"
                  basePath={tabPath("registrations")}
                  responsesActive={responsesActive}
                  eventSlug={event.slug}
                  purpose="event_registration"
                >
                  <GroupEventRegistrations groupId={groupId} eventId={event.id} canManage={canManage} />
                </EventRecordSections>
              ))}

            {activeTab === "proposals" &&
              (recordOpen && detailId ? (
                <ProposalDetailPage
                  key={detailId}
                  slug={event.slug}
                  proposalId={detailId}
                  tab={detailTab}
                  segment={detailSegment}
                  tabHref={(key) =>
                    `${tabPath("proposals")}/${encodeURIComponent(detailId)}${key === "submission" ? "" : `/${key}`}`
                  }
                  parentNavigation
                />
              ) : (
                <EventRecordSections
                  label="Proposal"
                  basePath={tabPath("proposals")}
                  responsesActive={responsesActive}
                  eventSlug={event.slug}
                  purpose="proposal_submission"
                >
                  <GroupEventProposals groupId={groupId} eventId={event.id} eventSlug={event.slug} />
                </EventRecordSections>
              ))}

            {activeTab === "invitations" && invitationAudience && (
              <>
                {invitationAudiences.length > 1 && invitationSegment !== "new" && (
                  <Tabs
                    label="Invitation audiences"
                    items={invitationAudiences.map(({ key, label }) => ({ key, label }))}
                    active={invitationAudience.key}
                    hrefFor={invitationPath}
                  />
                )}
                <GroupEventInvitations
                  key={invitationAudience.key}
                  groupId={groupId}
                  event={event}
                  inviteType={invitationAudience.inviteType}
                  segment={invitationSegment}
                  listPath={invitationPath(invitationAudience.key)}
                />
              </>
            )}

            {activeTab === "communications" && (
              // `…/communications/new` composes for attendees;
              // `…/communications/speakers/new` for speakers.
              <GroupEventCommunications
                groupId={groupId}
                eventId={event.id}
                audience={detailId === NEW_CAMPAIGN_SEGMENT ? undefined : detailId}
                composing={detailId === NEW_CAMPAIGN_SEGMENT || detailTab === NEW_CAMPAIGN_SEGMENT}
                audienceHref={(audience) =>
                  audience === "attendees" ? tabPath("communications") : `${tabPath("communications")}/${audience}`
                }
              />
            )}

            {activeTab === "team" && <Team slug={event.slug} teamSegment={detailId} teamPath={tabPath("team")} />}

            {activeTab === "promoters" && (
              <Promoters slug={event.slug} subTab={detailId} basePath={tabPath("promoters")} />
            )}

            {activeTab === "stats" && <EventStats slug={event.slug} section={detailId} basePath={tabPath("stats")} />}

            {activeTab === "settings" && (
              <>
                {/* The record's own facts, edited where they are read: one
                    Edit in the panel's header turns them into the form, and
                    Save or Cancel puts the facts back. An event that belongs
                    to a meeting series is edited through the series. */}
                <Panel aria-label={editing ? "Edit event" : "Event details"}>
                  <PanelHeader title={editing ? "Edit event" : "Event details"}>
                    {!editing && standalone && (
                      <Menu
                        label="Event actions"
                        align="end"
                        items={[{ id: "edit", label: "Edit event", onSelect: () => setEditing(true) }]}
                      />
                    )}
                    {/* Going to the meeting series is navigation, not an
                        action, so it stays an anchor and borrows the button's
                        appearance rather than its element. */}
                    {event.seriesId && (
                      <ButtonLink size="sm" href={`#/groups/${encodeURIComponent(groupId)}/meetings`}>
                        Manage meeting series
                      </ButtonLink>
                    )}
                  </PanelHeader>
                  <PanelBody>
                    {editing ? (
                      <GroupEventEditor
                        groupId={groupId}
                        event={event}
                        onSaved={async () => {
                          setEditing(false);
                          await onUpdated?.();
                        }}
                        onCancel={() => setEditing(false)}
                      />
                    ) : (
                      <DescriptionList
                        items={[
                          { term: "Name", value: event.name },
                          { term: "Slug", value: <span class="pk-mono">{event.slug}</span> },
                          { term: "Profile", value: EVENT_PROFILE_LABELS[event.profileKey ?? "conference"] },
                          { term: "Starts", value: formatEventWhen(event.startsAt, event.timezone, event.location) },
                          { term: "Ends", value: formatEventWhen(event.endsAt, event.timezone, event.location) },
                          { term: "Time zone", value: event.timezone },
                          { term: "Location", value: event.location },
                          { term: "Visibility", value: EVENT_VISIBILITY_LABELS[event.visibility] },
                          {
                            term: "Peer invitation limit",
                            value: event.inviteLimitAttendee != null ? String(event.inviteLimitAttendee) : undefined,
                          },
                          {
                            term: "Links",
                            value:
                              event.links.length > 0 ? <LinkList links={event.links} label="Event links" /> : undefined,
                          },
                        ]}
                      />
                    )}
                  </PanelBody>
                </Panel>

                {!event.seriesId && (
                  <LazyGroupEventConfiguration event={event} groupId={groupId} onUpdated={onUpdated} />
                )}

                <Panel aria-label="Sponsor tiers">
                  <PanelHeader title="Sponsor tiers" />
                  <PanelBody>
                    <LazySponsorTiersTab
                      slug={event.slug}
                      canWrite={canManage}
                      endpoint={
                        "/api/v1/groups/" +
                        encodeURIComponent(groupId) +
                        "/events/" +
                        encodeURIComponent(event.id) +
                        "/sponsors/tiers"
                      }
                    />
                  </PanelBody>
                </Panel>

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
    </BreadcrumbBranch>
  );
}
