import { eventClock } from "../../../../../shared/event-clock";
import { groupEventWhenAndWhere } from "./group-event-place";
import { EventStaffScanner } from "./EventStaffScanner";
/** URL-addressed event record and nested sections inside its owning group. */
import { useEffect, useState } from "preact/hooks";
import { usePortalHashLocation } from "../../hash-location";
import { hasEventAgendaPermission } from "../events/event-agenda-access";
import { portalSession } from "../../state";
import type { PortalSession } from "../../types";
import type { BadgePrintScope } from "../../../../components/event-badges/badge-print-population";
import type { GroupEvent } from "../../../../../shared/schemas/group-events";
import { EVENT_PROFILE_LABELS } from "../../../../../shared/schemas/event-series";
import { Badge } from "../../../../components/Badge";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { Tabs } from "../../../../components/Tabs";
import { BreadcrumbBranch } from "../../../../ui/BreadcrumbScope";
import { ProfileHeader } from "../../../../ui/ProfileHeader";
import { lazy, Suspense } from "preact/compat";
import { Spinner } from "../../../../components/Spinner";
const BadgeCredentials = lazy(() =>
  import("../events/detail/badges/BadgeCredentials").then((module) => ({ default: module.BadgeCredentials })),
);
const SponsorLeads = lazy(() =>
  import("../events/detail/agenda/SponsorLeads").then((module) => ({ default: module.SponsorLeads })),
);
const AgendaEditor = lazy(() =>
  import("../events/detail/agenda/AgendaEditor").then((module) => ({ default: module.AgendaEditor })),
);
const EventLiveControlRoom = lazy(() =>
  import("../events/detail/live/EventLiveControlRoom").then((module) => ({ default: module.EventLiveControlRoom })),
);
const EventStats = lazy(() => import("../events/detail/EventStats").then((module) => ({ default: module.EventStats })));
import { ProposalDetailPage } from "../events/detail/ProposalDetailPage";
import { GroupEventCommunications, NEW_CAMPAIGN_SEGMENT } from "./GroupEventCommunications";
import { GroupEventInvitations } from "./GroupEventInvitations";
import { GroupEventProposals } from "./GroupEventProposals";
import { groupEventProposalPath } from "./GroupEventProposals";
import { EventProposalSpeakersTable } from "../../../../components/proposals/EventProposalSpeakersTable";
import { GroupEventOverview } from "./GroupEventOverview";
import { GroupEventRegistrationRecord } from "./GroupEventRegistrationRecord";
import { GroupEventRegistrations } from "./GroupEventRegistrations";
import { GroupEventSettingsTab } from "./GroupEventSettingsTab";
// `pk-datalist-aligned` and `pk-mono` ship in Content.css, a lazy chunk
// rather than the entry stylesheet.
import "../../../../ui/Content.css";

const EVENT_RESPONSES_SEGMENT = "responses";
import { CALL_SEGMENT, GroupEventRecordSections } from "./GroupEventRecordSections";
import {
  EVENT_WORKSPACE_TABS,
  GROUP_EVENT_OVERVIEW_TAB,
  visibleEventWorkspaceTabs,
} from "./group-event-workspace-tabs";

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
  useEffect(() => {
    const base = `/groups/${encodeURIComponent(groupId)}/events/${encodeURIComponent(event.id)}`;
    if (tab === "proposals" && detailId === CALL_SEGMENT) navigate(`${base}/settings/cfp`);
    if (tab === "settings" && detailId === "team" && detailTab === "staffing") navigate(`${base}/settings/team`);
  }, [tab, detailId, detailTab, groupId, event.id]);
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
  const callActive = activeTab === "proposals" && detailId === CALL_SEGMENT;
  const recordOpen =
    detailId !== undefined &&
    !responsesActive &&
    !speakersActive &&
    !callActive &&
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
            title={event.name}
            context={
              <Badge
                status={event.profileKey ?? "event"}
                label={EVENT_PROFILE_LABELS[event.profileKey ?? "conference"]}
              />
            }
            lede={
              <>
                {/* Organizers plan on the event's own clock, named, whatever
                    their own zone — and from the start the event is
                    configured with, not its first session. A meeting series
                    without a start of its own falls back to its next meeting. */}
                {groupEventWhenAndWhere(event, event.startsAt ?? event.nextOccurrenceAt)}
              </>
            }
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
              <GroupEventOverview
                event={event}
                groupId={groupId}
                canRegister={canRegister}
                visibleTabs={new Set(visibleTabs.map((item) => item.key))}
                tabHref={(key) => usePortalHashLocation.hrefs(tabPath(key))}
              />
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
                  teamEligibilityPath={`${tabPath("settings")}/team`}
                />
              </Suspense>
            )}
            {activeTab === "scanner" && <EventStaffScanner eventId={event.id} slug={event.slug} />}
            {activeTab === "live" && (
              <Suspense fallback={<Spinner />}>
                <EventLiveControlRoom
                  slug={event.slug}
                  occurrenceId={detailId}
                  sessionPath={(occurrenceId) => `${tabPath("live")}/${encodeURIComponent(occurrenceId)}`}
                  eventPath={tabPath(GROUP_EVENT_OVERVIEW_TAB)}
                />
              </Suspense>
            )}
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
                    timeZone: eventClock(event),
                    canRead: hasEventAgendaPermission(event.id, "agenda:attendance_read"),
                    canImport: hasEventAgendaPermission(event.id, "agenda:attendance_import"),
                    canCorrect: hasEventAgendaPermission(event.id, "agenda:attendance_correct"),
                  }}
                />
              </Suspense>
            )}

            {activeTab === "settings" && (
              <GroupEventSettingsTab
                event={event}
                groupId={groupId}
                settingsPath={tabPath("settings")}
                detailId={detailId}
                detailTab={detailTab}
                detailSegment={detailSegment}
                onUpdated={onUpdated}
              />
            )}
          </section>
        )}
      </section>
    </BreadcrumbBranch>
  );
}
