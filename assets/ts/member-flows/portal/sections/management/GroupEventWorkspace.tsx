import { portalHasGlobalPermission } from "../../shell/portal-navigation";
import { EventStaffScanner } from "./EventStaffScanner";
/** URL-addressed event record and nested sections inside its owning group. */
import { useState } from "preact/hooks";
import { usePortalHashLocation } from "../../hash-location";
import { hasEventAgendaPermission } from "../events/event-agenda-access";
import { portalSession } from "../../state";
import type { PortalSession } from "../../types";
import type { BadgePrintScope } from "../../../../components/event-badges/badge-print-population";
import type { GroupEvent } from "../../../../../shared/schemas/group-events";
import {
  EVENT_PROFILE_LABELS,
  EVENT_REGISTRATION_POLICY_LABELS,
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
import { lazy, Suspense } from "preact/compat";
import { Spinner } from "../../../../components/Spinner";
const RawEvidenceRetentionPolicy = lazy(() =>
  import("../events/detail/settings/RawEvidenceRetentionPolicy").then((module) => ({
    default: module.RawEvidenceRetentionPolicy,
  })),
);
const EventRecordings = lazy(() =>
  import("../events/detail/settings/EventRecordings").then((module) => ({ default: module.EventRecordings })),
);
const GroupEventScheduling = lazy(() =>
  import("./GroupEventScheduling").then((module) => ({ default: module.GroupEventScheduling })),
);
const BadgeCredentials = lazy(() =>
  import("../events/detail/badges/BadgeCredentials").then((module) => ({ default: module.BadgeCredentials })),
);
const SponsorLeads = lazy(() =>
  import("../events/detail/agenda/SponsorLeads").then((module) => ({ default: module.SponsorLeads })),
);
const AgendaEditor = lazy(() =>
  import("../events/detail/agenda/AgendaEditor").then((module) => ({ default: module.AgendaEditor })),
);
const EventStats = lazy(() => import("../events/detail/EventStats").then((module) => ({ default: module.EventStats })));

const EventTeamSettings = lazy(() =>
  import("../events/detail/settings/EventTeamSettings").then((module) => ({ default: module.EventTeamSettings })),
);
import { ProposalDetailPage } from "../events/detail/ProposalDetailPage";
import { LazySponsorTiersTab } from "../events/detail/settings/LazySponsorTiersTab";
import { GroupEventCommunications, NEW_CAMPAIGN_SEGMENT } from "./GroupEventCommunications";
import { LazyGroupEventConfiguration } from "./LazyGroupEventConfiguration";
import { GroupEventEditor } from "./GroupEventEditor";
import { GroupEventInvitations } from "./GroupEventInvitations";
import { GroupEventProposals } from "./GroupEventProposals";
import { groupEventProposalPath } from "./GroupEventProposals";
import { EventProposalSpeakersTable } from "../../../../components/proposals/EventProposalSpeakersTable";
import { GroupEventOverview } from "./GroupEventOverview";
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
import { GroupEventRecordSections } from "./GroupEventRecordSections";

const EVENT_WORKSPACE_TABS: readonly EventWorkspaceTabDef[] = [
  { key: GROUP_EVENT_OVERVIEW_TAB, label: "Overview", visible: () => true },
  {
    key: "registrations",
    label: "Registrations",
    visible: (event) => event.capabilities.includes("manage_attendance") || event.capabilities.includes("manage"),
  },
  { key: "agenda", label: "Agenda", visible: (event) => hasEventAgendaPermission(event.id, "agenda:read") },
  {
    key: "scanner",
    label: "Scanner",
    visible: (event) =>
      ["agenda:scan", "agenda:check", "agenda:admit", "agenda:attendance_record"].some((permission) =>
        hasEventAgendaPermission(event.id, permission as "agenda:scan"),
      ),
  },
  {
    key: "leads",
    label: "Sponsor leads",
    visible: () =>
      portalSession.value?.staff?.grants.some(
        (grant) =>
          grant.contextType === "event_sponsor" &&
          ["agenda:leads_view", "agenda:leads_capture", "agenda:leads_export"].includes(grant.permission),
      ) ?? false,
  },
  { key: "proposals", label: "Proposals", visible: (event) => event.proposalAccess?.canRead === true },
  {
    key: "invitations",
    label: "Invitations",
    visible: (event) => event.capabilities.includes("manage") || event.proposalAccess?.canFinalize === true,
  },
  { key: "communications", label: "Communications", visible: (event) => event.capabilities.includes("manage") },
  {
    key: "stats",
    label: "Analytics",
    visible: (event) =>
      event.capabilities.includes("manage_attendance") ||
      hasEventAgendaPermission(event.id, "agenda:attendance_read") ||
      hasEventAgendaPermission(event.id, "agenda:attendance_import"),
  },
  {
    key: "settings",
    label: "Settings",
    visible: (event) => event.capabilities.includes("manage") || hasEventAgendaPermission(event.id, "agenda:write"),
  },
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
  if (tab === "team" || tab === "promoters" || tab === "badges" || tab === "attendance") {
    const legacy = tab;
    detailSegment = detailTab;
    detailTab = detailId;
    detailId = legacy;
    tab =
      legacy === "team" ? "settings" : legacy === "promoters" || legacy === "attendance" ? "stats" : "registrations";
  }
  const [, navigate] = usePortalHashLocation();
  const [editing, setEditing] = useState(false);
  const [badgePrint, setBadgePrint] = useState<{
    scope: BadgePrintScope;
    session: PortalSession | null;
    eventId: string;
  } | null>(null);
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
  const speakersActive = activeTab === "proposals" && detailId === "speakers";
  const recordOpen =
    detailId !== undefined &&
    !responsesActive &&
    !speakersActive &&
    ((activeTab === "registrations" && detailId !== "badges") || activeTab === "proposals");

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
              <GroupEventOverview event={event} groupId={groupId} canRegister={canRegister} />
            )}

            {activeTab === "registrations" &&
              (recordOpen && detailId ? (
                <GroupEventRegistrationRecord
                  key={detailId}
                  groupId={groupId}
                  eventId={event.id}
                  eventSlug={event.slug}
                  badgesPath={`${tabPath("registrations")}/badges`}
                  registrationId={detailId}
                  canVip={canManage}
                />
              ) : (
                <GroupEventRecordSections
                  label="Registration"
                  basePath={tabPath("registrations")}
                  responsesActive={responsesActive}
                  eventSlug={event.slug}
                  purpose="event_registration"
                  badgesActive={detailId === "badges"}
                  badges={
                    canManage ? (
                      <Suspense fallback={<Spinner />}>
                        <BadgeCredentials
                          slug={event.slug}
                          basePath={`${tabPath("registrations")}/badges`}
                          credentialId={detailTab}
                          segment={detailSegment}
                          eventId={event.id}
                          groupId={groupId}
                          printRequest={badgePrint?.eventId === event.id ? badgePrint : null}
                          onPrintClose={() => setBadgePrint(null)}
                        />
                      </Suspense>
                    ) : detailId === "badges" ? (
                      <ErrorAlert error="Badge management is not available to your current identity." />
                    ) : undefined
                  }
                >
                  <GroupEventRegistrations
                    groupId={groupId}
                    eventId={event.id}
                    eventSlug={event.slug}
                    badgesPath={`${tabPath("registrations")}/badges`}
                    canManage={canManage}
                    onPrint={(scope) => {
                      setBadgePrint({ scope, session: portalSession.value, eventId: event.id });
                      navigate(`${tabPath("registrations")}/badges`);
                    }}
                  />
                </GroupEventRecordSections>
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
                <GroupEventRecordSections
                  label="Proposal"
                  basePath={tabPath("proposals")}
                  responsesActive={responsesActive}
                  speakersActive={speakersActive}
                  speakers={
                    <EventProposalSpeakersTable
                      slug={event.slug}
                      rowHref={(speaker) =>
                        usePortalHashLocation.hrefs(groupEventProposalPath(groupId, event.id, speaker.proposalId))
                      }
                    />
                  }
                  eventSlug={event.slug}
                  purpose="proposal_submission"
                >
                  <GroupEventProposals groupId={groupId} eventId={event.id} eventSlug={event.slug} />
                </GroupEventRecordSections>
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
              <GroupEventCommunications
                groupId={groupId}
                eventId={event.id}
                eventSlug={event.slug}
                composing={detailId === NEW_CAMPAIGN_SEGMENT}
                listPath={tabPath("communications")}
              />
            )}

            {activeTab === "agenda" && (
              <Suspense fallback={<Spinner />}>
                <AgendaEditor
                  slug={event.slug}
                  canEdit={hasEventAgendaPermission(event.id, "agenda:write")}
                  canReviewAppearances={hasEventAgendaPermission(event.id, "agenda:appearance_approve")}
                  teamEligibilityPath={`${tabPath("settings")}/team/staffing`}
                />
              </Suspense>
            )}
            {activeTab === "scanner" && <EventStaffScanner eventId={event.id} slug={event.slug} />}
            {activeTab === "leads" && (
              <Suspense fallback={<Spinner />}>
                <SponsorLeads slug={event.slug} timeZone={event.timezone} />
              </Suspense>
            )}
            {activeTab === "stats" && (
              <Suspense fallback={<Spinner label="Loading analytics…" />}>
                <EventStats
                  slug={event.slug}
                  section={detailId}
                  subTab={detailTab}
                  basePath={tabPath("stats")}
                  legacyAttendanceBasePath={tabPath("attendance")}
                  canViewAnalytics={event.capabilities.includes("manage_attendance")}
                  attendance={{
                    timeZone: event.timezone,
                    canRead: hasEventAgendaPermission(event.id, "agenda:attendance_read"),
                    canImport: hasEventAgendaPermission(event.id, "agenda:attendance_import"),
                    canCorrect: hasEventAgendaPermission(event.id, "agenda:attendance_correct"),
                  }}
                />
              </Suspense>
            )}

            {activeTab === "settings" && (
              <>
                <Tabs
                  label="Settings sections"
                  items={[
                    ...(canManage
                      ? [
                          { key: "general", label: "General" },
                          { key: "recordings", label: "Recordings" },
                        ]
                      : []),
                    { key: "team", label: "Team" },
                    ...(hasEventAgendaPermission(event.id, "agenda:write")
                      ? [{ key: "scheduling", label: "Scheduling" }]
                      : []),
                  ]}
                  active={
                    detailId === "team" || detailId === "scheduling" || detailId === "recordings"
                      ? detailId
                      : canManage
                        ? "general"
                        : "team"
                  }
                  hrefFor={(key) => (key === "general" ? tabPath("settings") : `${tabPath("settings")}/${key}`)}
                />
                {detailId === "team" || (!canManage && !detailId) ? (
                  <Suspense fallback={<Spinner label="Loading team…" />}>
                    <EventTeamSettings
                      slug={event.slug}
                      section={detailTab}
                      personId={detailSegment}
                      teamPath={`${tabPath("settings")}/team`}
                      staffingPath={`${tabPath("agenda")}?view=staffing`}
                      canManage={canManage}
                      canEditStaffing={hasEventAgendaPermission(event.id, "agenda:write")}
                    />
                  </Suspense>
                ) : detailId === "recordings" && canManage ? (
                  <Suspense fallback={<Spinner />}>
                    <EventRecordings
                      slug={event.slug}
                      canLinkProviderMeetings={portalHasGlobalPermission(portalSession.value, "events:manage")}
                      basePath={`${tabPath("settings")}/recordings`}
                      sourceId={detailTab}
                    />
                  </Suspense>
                ) : detailId === "scheduling" ? (
                  <Suspense fallback={<Spinner />}>
                    <GroupEventScheduling
                      slug={event.slug}
                      canEdit={hasEventAgendaPermission(event.id, "agenda:write")}
                      backPath={tabPath("settings")}
                    />
                  </Suspense>
                ) : !canManage ? (
                  <ErrorAlert error="Event settings are not available to your current identity." />
                ) : (
                  <>
                    <Panel aria-label={editing ? "Edit event" : "Event details"}>
                      <PanelHeader title={editing ? "Edit event" : "Event details"}>
                        {!editing && standalone && (
                          <Menu
                            label="Event actions"
                            align="end"
                            items={[{ id: "edit", label: "Edit event", onSelect: () => setEditing(true) }]}
                          />
                        )}
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
                              {
                                term: "Starts",
                                value: formatEventWhen(event.startsAt, event.timezone, event.location),
                              },
                              { term: "Ends", value: formatEventWhen(event.endsAt, event.timezone, event.location) },
                              { term: "Time zone", value: event.timezone },
                              { term: "Location", value: event.location },
                              { term: "Visibility", value: EVENT_VISIBILITY_LABELS[event.visibility] },
                              {
                                term: "Peer invitation limit",
                                value:
                                  event.inviteLimitAttendee != null ? String(event.inviteLimitAttendee) : undefined,
                              },
                              {
                                term: "Links",
                                value:
                                  event.links.length > 0 ? (
                                    <LinkList links={event.links} label="Event links" />
                                  ) : undefined,
                              },
                            ]}
                          />
                        )}
                      </PanelBody>
                    </Panel>

                    {!event.seriesId && (
                      <LazyGroupEventConfiguration event={event} groupId={groupId} onUpdated={onUpdated} />
                    )}
                    <Suspense fallback={<Spinner label="Loading evidence retention…" />}>
                      <RawEvidenceRetentionPolicy event={event} />
                    </Suspense>

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
              </>
            )}
          </section>
        )}
      </section>
    </BreadcrumbBranch>
  );
}
