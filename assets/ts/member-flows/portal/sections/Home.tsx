import { eventDestination } from "./events/event-destination";
import "./Home.css";
/** A personal landing with actionable work, upcoming dates, and useful paths. */
import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import { Link } from "wouter";
import type { z } from "zod";
import { currentUserFormsListResponseSchema } from "../../../../shared/schemas/member-forms";
import {
  currentUserMeetingSeriesListResponseSchema,
  type MemberMeetingSeries,
} from "../../../../shared/schemas/member-meetings";
import { eventsListResponseSchema } from "../../../../shared/schemas/event-management";
import { userOrganizationsListResponseSchema } from "../../../../shared/schemas/user-organizations";
import { currentUserVotesListResponseSchema } from "../../../../shared/schemas/votes";
import { formatDateTime, formatWeekdayTimeInZone } from "../../../../shared/format-date";
import { meetingEntryUrl } from "../../../../shared/meeting-entry-navigation";
import { meetingSeriesCalendarPath, registrationCalendarPath } from "../../../../shared/calendar-subscription-links";
import { MEETING_JOIN_ACTION_LEAD_MINUTES } from "../../../../shared/schemas/meeting-entry-policy";
import { matchRecurrenceShape, describeRecurrenceShape } from "../../../components/RecurrenceEditor";
import { Badge } from "../../../components/Badge";
import { ErrorAlert } from "../../../components/ErrorAlert";
import { IconCalendarDownload } from "../../../components/icons";
import { Spinner } from "../../../components/Spinner";
import { EmptyState } from "../../../ui/EmptyState";
import { PageHeader } from "../../../ui/PageHeader";
import { Panel, PanelBody, PanelHeader } from "../../../ui/Panel";
import { ButtonLink } from "../../../ui/Button";
import { useData } from "../../../hooks/useData";
import { getJson } from "../../../shared/api-client";
import { portalSession, profile } from "../state";
import { fmt, formatDateRange, formatRelativeDays } from "../ui";
import { ViewerEventState } from "./events/ViewerEventState";
import { eventParticipantRecordPath } from "./events/event-participant-paths";
import { portalSectionEnabled } from "../shell/portal-navigation";

type MemberVote = z.infer<typeof currentUserVotesListResponseSchema>["votes"][number];
type MemberForm = z.infer<typeof currentUserFormsListResponseSchema>["forms"][number];
type UserOrganization = z.infer<typeof userOrganizationsListResponseSchema>["organizations"][number];

function PanelCard({
  title,
  children,
  footer,
}: {
  title: string;
  children: ComponentChildren;
  footer?: ComponentChildren;
}) {
  return (
    <Panel class="pk-home-card">
      <PanelHeader title={title} />
      <PanelBody>{children}</PanelBody>
      {footer && <footer class="pk-home-meetings-footer">{footer}</footer>}
    </Panel>
  );
}

function PanelState({
  loading,
  error,
  empty,
  count,
}: {
  loading: boolean;
  error: string | Error | null | undefined;
  empty: string;
  count: number;
}) {
  if (loading) return <Spinner />;
  if (error) return <ErrorAlert error={error} />;
  // EmptyState carries role="status", so an empty panel says so rather than
  // merely looking empty.
  if (count === 0) return <EmptyState title={empty} />;
  return null;
}

function votePath(vote: MemberVote): string {
  return `/groups/${encodeURIComponent(vote.ownerGroupId)}/votes/${encodeURIComponent(vote.id)}`;
}

function formPath(form: MemberForm): string {
  return `/groups/${encodeURIComponent(form.ownerGroupId)}/forms/${encodeURIComponent(form.placementId)}`;
}

function AttentionPanel() {
  const votes = useData(
    () => getJson("/api/v1/users/current/votes?status=open&limit=10", currentUserVotesListResponseSchema),
    [],
  );
  const forms = useData(() => getJson("/api/v1/users/current/forms?limit=10", currentUserFormsListResponseSchema), []);
  const organizations = useData(
    () => getJson("/api/v1/users/current/organizations?limit=12", userOrganizationsListResponseSchema),
    [],
  );

  const openBallots = (votes.data?.votes ?? []).filter((vote) => vote.canCastBallot && !vote.hasCastBallot).slice(0, 5);
  const openSurveys = (forms.data?.forms ?? [])
    .filter((form) => form.acceptingResponses && !form.hasSubmitted)
    .slice(0, 5);
  const pendingReviews = (organizations.data?.organizations ?? []).filter((org) => org.hasPendingReview);
  const loading = votes.loading || forms.loading || organizations.loading;
  const error = votes.error ?? forms.error ?? organizations.error;
  const count = openBallots.length + openSurveys.length + pendingReviews.length;

  if (!loading && !error && count === 0) return null;

  return (
    <PanelCard title="Needs your voice">
      <PanelState loading={loading} error={error} empty="Nothing is waiting on you right now." count={count} />
      {!loading && !error && count > 0 && (
        <ul class="pk-plain-list pk-stack pk-stack--tight" aria-label="Items waiting on you">
          {openBallots.map((vote) => (
            <li key={`vote-${vote.id}`} class="pk-cluster">
              <Link href={votePath(vote)}>Vote on: {vote.title}</Link>
              <span class="pk-small">closes {fmt(vote.closesAt)}</span>
            </li>
          ))}
          {openSurveys.map((form) => (
            <li key={`form-${form.placementId}`} class="pk-cluster">
              <Link href={formPath(form)}>Respond: {form.title}</Link>
              <span class="pk-small">{form.ownerGroupName}</span>
              {form.closesAt && <span class="pk-small">closes {fmt(form.closesAt)}</span>}
            </li>
          ))}
          {pendingReviews.map((organization) => (
            <li key={`review-${organization.organizationId}`} class="pk-cluster">
              <Link href={`/organizations/${encodeURIComponent(organization.organizationId)}`}>
                Review pending: {organization.name}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </PanelCard>
  );
}

function meetingSchedule(series: MemberMeetingSeries): string {
  const shape = matchRecurrenceShape(series.recurrenceRule);
  if (!shape || shape.mode === "none") return "";
  if (shape.mode === "weekly") {
    const { weekday, time } = formatWeekdayTimeInZone(series.startsAt, series.timezone);
    const frequency =
      shape.interval === 1 ? "Every" : shape.interval === 2 ? "Every other" : `Every ${shape.interval} weeks on`;
    return `${frequency} ${weekday} at ${time} (${series.timezone})`;
  }
  const time = formatWeekdayTimeInZone(series.startsAt, series.timezone).time;
  return `${describeRecurrenceShape(shape).replace(/\.$/, "")} at ${time} (${series.timezone})`;
}

function MeetingsPanel() {
  const [now, setNow] = useState(() => Date.now());
  const meetings = useData(
    () => getJson("/api/v1/users/current/meetings/series?limit=5", currentUserMeetingSeriesListResponseSchema),
    [],
  );
  const series = meetings.data?.series ?? [];
  useEffect(() => {
    const timer = window.setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (meetings.data?.series.some((meeting) => Date.parse(meeting.nextEndsAt) <= current)) {
        void meetings.reload();
      }
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [meetings.data?.series, meetings.reload]);

  return (
    <PanelCard title="Upcoming meetings" footer={series.length > 0 && <span>Personal calendar · Do not share</span>}>
      <PanelState
        loading={meetings.loading}
        error={meetings.error}
        empty="No meetings are scheduled in your groups."
        count={series.length}
      />
      {series.length > 0 && (
        <ul class="pk-plain-list pk-stack pk-stack--snug" aria-label="Upcoming meetings">
          {series.map((meeting) => (
            <li key={meeting.seriesId} class="pk-stack pk-stack--tight">
              <div class="pk-cluster pk-cluster--nowrap">
                <Link
                  href={`/groups/${encodeURIComponent(meeting.groupId)}/meetings/${encodeURIComponent(meeting.seriesId)}`}
                >
                  {meeting.eventName}
                </Link>
                <ButtonLink
                  variant="ghost"
                  size="sm"
                  icon
                  class="pk-push"
                  aria-label="Download the full series calendar (.ics)"
                  title="Download the full series calendar (.ics)"
                  href={meetingSeriesCalendarPath(meeting.groupId, meeting.seriesId, { personal: true })}
                >
                  <IconCalendarDownload />
                </ButtonLink>
              </div>
              <span class="pk-small">{meeting.groupName}</span>
              {meetingSchedule(meeting) && <span class="pk-small">{meetingSchedule(meeting)}</span>}
              <div class="pk-cluster">
                <span class="pk-small">
                  {now >= Date.parse(meeting.nextStartsAt) ? "Happening now" : "Next"} (your time):{" "}
                  {formatDateTime(meeting.nextStartsAt, { zoneName: true })}
                </span>
                {formatRelativeDays(meeting.nextStartsAt) && (
                  <span class="pk-small pk-push">({formatRelativeDays(meeting.nextStartsAt)})</span>
                )}
                <ButtonLink
                  variant="ghost"
                  size="sm"
                  icon
                  aria-label="Download only the next meeting (.ics)"
                  title="Download only the next meeting (.ics)"
                  href={meetingSeriesCalendarPath(meeting.groupId, meeting.seriesId, {
                    personal: true,
                    occurrenceId: meeting.nextOccurrenceId,
                  })}
                >
                  <IconCalendarDownload />
                </ButtonLink>
              </div>
              {meeting.canJoin &&
                now >= Date.parse(meeting.nextStartsAt) - MEETING_JOIN_ACTION_LEAD_MINUTES * 60_000 &&
                now < Date.parse(meeting.nextEndsAt) && (
                  <ButtonLink href={meetingEntryUrl(meeting.nextOccurrenceId)} size="sm">
                    Join meeting
                  </ButtonLink>
                )}
            </li>
          ))}
        </ul>
      )}
    </PanelCard>
  );
}

function EventsPanel() {
  const events = useData(() => {
    const from = encodeURIComponent(new Date().toISOString());
    return getJson(`/api/v1/events?kind=standalone&from=${from}&limit=5`, eventsListResponseSchema);
  }, []);
  const rows = events.data?.events ?? [];

  return (
    <PanelCard title="Upcoming events">
      <PanelState
        loading={events.loading}
        error={events.error}
        empty="No upcoming events right now."
        count={rows.length}
      />
      {rows.length > 0 && (
        <ul class="pk-plain-list pk-stack pk-stack--snug" aria-label="Upcoming events">
          {rows.map((event) => {
            const relative = formatRelativeDays(event.startsAt);
            const viewer = "viewer" in event ? event.viewer : null;
            return (
              <li key={event.id} class="pk-stack pk-stack--tight">
                <div class="pk-home-event-heading">
                  {/* No utility class: `.pk-strong` painted the anchor in body
                  ink, so the one clickable thing in the row was the only line
                  not dressed as a link. */}
                  <a href={eventDestination(event)}>{event.name}</a>
                  {event.participation?.registrationId && event.participation.registrationStatus === "registered" && (
                    <ButtonLink
                      variant="ghost"
                      size="sm"
                      icon
                      aria-label={`Download your personal calendar for ${event.name} (.ics)`}
                      title="Download your personal event calendar (.ics)"
                      href={registrationCalendarPath(event.slug, event.participation.registrationId)}
                    >
                      <IconCalendarDownload />
                    </ButtonLink>
                  )}
                </div>
                {event.startsAt && (
                  <span class="pk-small">
                    {formatDateRange(event.startsAt, event.endsAt, event.timezone)}
                    {relative ? ` (${relative})` : ""}
                  </span>
                )}
                {"location" in event && event.location && <span class="pk-small">{event.location}</span>}
                {viewer && (
                  <ViewerEventState
                    viewer={viewer}
                    href={
                      event.participation?.registrationId
                        ? eventParticipantRecordPath(event.slug, "registration", event.participation.registrationId)
                        : undefined
                    }
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </PanelCard>
  );
}

function OrganizationAffiliation() {
  const organizations = useData(
    () => getJson("/api/v1/users/current/organizations?limit=6", userOrganizationsListResponseSchema),
    [],
  );
  const rows: UserOrganization[] = organizations.data?.organizations ?? [];

  if (organizations.loading) return null;
  if (organizations.error) return <ErrorAlert error={organizations.error} />;
  return (
    <div class="pk-home-affiliation">
      <span class="pk-small pk-muted">{rows.length === 1 ? "Organization" : "Organizations"}</span>
      {rows.length === 0 ? (
        <span class="pk-small">Participating as an individual</span>
      ) : (
        <ul class="pk-inline-list" aria-label="Your organizations">
          {rows.map((organization) => (
            <li key={organization.organizationId} class="pk-cluster">
              <Link href={`/organizations/${encodeURIComponent(organization.organizationId)}`}>
                {organization.name}
              </Link>
              {organization.isPrimaryContact ? (
                <Badge status="active" label="Primary contact" />
              ) : organization.isOrgContact ? (
                <Badge status="active" label="Contact" />
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {(rows.length > 1 || organizations.data?.page.hasMore) && <Link href="/organizations">View all</Link>}
    </div>
  );
}

function HomeShortcuts() {
  const session = portalSession.value;
  const links = [
    portalSectionEnabled(session, "groups") && { label: "Working groups", href: "/groups" },
    portalSectionEnabled(session, "events") && { label: "Events", href: "/events" },
    portalSectionEnabled(session, "sponsors") && { label: "Sponsorships", href: "/sponsors" },
    portalSectionEnabled(session, "users") &&
      session?.identity && {
        label: "My profile",
        href: `/users/${encodeURIComponent(session.identity.id)}`,
      },
  ].filter((link): link is { label: string; href: string } => Boolean(link));

  return (
    <nav class="pk-home-shortcuts" aria-label="Quick links">
      <span class="pk-small pk-muted">Quick links</span>
      <ul class="pk-inline-list">
        {links.map((link) => (
          <li key={link.href}>
            <Link href={link.href}>{link.label}</Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function Home() {
  const session = portalSession.value;
  const isMember = Boolean(session?.member);
  const firstName = profile.value?.preferredName || profile.value?.firstName || "";

  return (
    <div class="pk pk-stack">
      <Panel stripe class="pk-home-intro">
        <PanelBody>
          <PageHeader title="Home" description={firstName ? `Welcome back, ${firstName}.` : "Welcome back."} />
          {isMember && <OrganizationAffiliation />}
          <HomeShortcuts />
        </PanelBody>
      </Panel>
      {isMember && <AttentionPanel />}
      <div class="pk-home-grid">
        {isMember && <MeetingsPanel />}
        <EventsPanel />
      </div>
    </div>
  );
}
