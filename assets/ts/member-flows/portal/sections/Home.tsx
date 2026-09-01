/**
 * The sign-in landing: the identity's consortium this week. Participation
 * comes first — things to vote on, answer, review, and attend — followed by
 * upcoming activity and the organizations the user represents. Every panel
 * renders a bounded self-scoped server page; nothing aggregates client-side
 * beyond selecting from one fetched page.
 */
import type { ComponentChildren } from "preact";
import { Link } from "wouter";
import type { z } from "zod";
import { myApplicationsListResponseSchema } from "../../../../shared/schemas/me";
import { currentUserFormsListResponseSchema } from "../../../../shared/schemas/member-forms";
import { currentUserMeetingsListResponseSchema } from "../../../../shared/schemas/member-meetings";
import { eventsListResponseSchema } from "../../../../shared/schemas/event-management";
import { userOrganizationsListResponseSchema } from "../../../../shared/schemas/user-organizations";
import { currentUserVotesListResponseSchema } from "../../../../shared/schemas/votes";
import { Badge } from "../../../components/Badge";
import { ErrorAlert } from "../../../components/ErrorAlert";
import { Spinner } from "../../../components/Spinner";
import { EmptyState } from "../../../ui/EmptyState";
import { Panel, PanelBody, PanelHeader } from "../../../ui/Panel";
import { useData } from "../../../hooks/useData";
import { getJson } from "../../../shared/api-client";
import { portalSession, profile } from "../state";
import { fmt, formatDateRange, formatRelativeDays } from "../ui";
import { ViewerEventState } from "./events/ViewerEventState";

type MemberVote = z.infer<typeof currentUserVotesListResponseSchema>["votes"][number];
type MemberForm = z.infer<typeof currentUserFormsListResponseSchema>["forms"][number];
type UserOrganization = z.infer<typeof userOrganizationsListResponseSchema>["organizations"][number];

function PanelCard({
  title,
  viewAll,
  children,
}: {
  title: string;
  viewAll?: { href: string; label: string };
  children: ComponentChildren;
}) {
  return (
    <Panel>
      <PanelHeader title={title}>
        {viewAll && (
          // The size utility goes on a wrapper rather than on the anchor:
          // `pk-small` also sets a muted ink, and utilities beat the base
          // layer, so putting it on the link would drain the link colour.
          <span class="pk-small">
            <Link href={viewAll.href}>{viewAll.label}</Link>
          </span>
        )}
      </PanelHeader>
      <PanelBody>{children}</PanelBody>
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

  return (
    <PanelCard title="Needs your voice">
      <PanelState loading={loading} error={error} empty="Nothing is waiting on you right now." count={count} />
      {!loading && !error && count > 0 && (
        <ul class="pk-stack pk-stack--tight" aria-label="Items waiting on you">
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

function MeetingsPanel() {
  const meetings = useData(
    () => getJson("/api/v1/users/current/meetings?limit=5", currentUserMeetingsListResponseSchema),
    [],
  );
  const occurrences = meetings.data?.occurrences ?? [];

  return (
    <PanelCard title="Upcoming meetings">
      <PanelState
        loading={meetings.loading}
        error={meetings.error}
        empty="No meetings are scheduled in your groups."
        count={occurrences.length}
      />
      {occurrences.length > 0 && (
        <ul class="pk-stack pk-stack--tight" aria-label="Upcoming meetings">
          {occurrences.map((occurrence) => (
            <li key={occurrence.occurrenceId} class="pk-cluster">
              <Link
                href={`/groups/${encodeURIComponent(occurrence.groupId)}/meetings/${encodeURIComponent(occurrence.seriesId)}`}
              >
                {occurrence.eventName}
              </Link>
              <span class="pk-small">{occurrence.groupName}</span>
              <span class="pk-small">{fmt(occurrence.startsAt)}</span>
              {formatRelativeDays(occurrence.startsAt) && (
                <span class="pk-small">({formatRelativeDays(occurrence.startsAt)})</span>
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
    return getJson(`/api/v1/events?from=${from}&limit=5`, eventsListResponseSchema);
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
        <ul class="pk-stack pk-stack--snug" aria-label="Upcoming events">
          {rows.map((event) => {
            const relative = formatRelativeDays(event.startsAt);
            const viewer = "viewer" in event ? event.viewer : null;
            const basePath = "basePath" in event ? event.basePath : null;
            return (
              <li key={event.id} class="pk-stack pk-stack--tight">
                <div class="pk-cluster">
                  {basePath ? (
                    <a class="pk-strong" href={basePath}>
                      {event.name}
                    </a>
                  ) : (
                    <span class="pk-strong">{event.name}</span>
                  )}
                  {event.startsAt && (
                    <span class="pk-small">{formatDateRange(event.startsAt, event.endsAt, event.timezone)}</span>
                  )}
                  {relative && <span class="pk-small">({relative})</span>}
                  {"location" in event && event.location && <span class="pk-small">{event.location}</span>}
                </div>
                {viewer && <ViewerEventState viewer={viewer} />}
              </li>
            );
          })}
        </ul>
      )}
    </PanelCard>
  );
}

function VotesPanel() {
  const votes = useData(
    () => getJson("/api/v1/users/current/votes?status=open&limit=5", currentUserVotesListResponseSchema),
    [],
  );
  const rows = votes.data?.votes ?? [];

  return (
    <PanelCard title="Open votes">
      <PanelState
        loading={votes.loading}
        error={votes.error}
        empty="No votes are open in your groups."
        count={rows.length}
      />
      {rows.length > 0 && (
        <ul class="pk-stack pk-stack--tight" aria-label="Open votes">
          {rows.map((vote) => (
            <li key={vote.id} class="pk-cluster">
              <Link href={votePath(vote)}>{vote.title}</Link>
              <span class="pk-small">closes {fmt(vote.closesAt)}</span>
              {vote.hasCastBallot ? (
                <Badge status="completed" label="Voted" />
              ) : vote.canCastBallot ? (
                <Badge status="pending" label="Not voted yet" />
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </PanelCard>
  );
}

function ApplicationsPanel() {
  const applications = useData(
    () => getJson("/api/v1/users/current/applications?limit=5", myApplicationsListResponseSchema),
    [],
  );
  const rows = applications.data?.applications ?? [];
  if (!applications.loading && !applications.error && rows.length === 0) return null;

  return (
    <PanelCard title="Your membership applications" viewAll={{ href: "/application", label: "View all" }}>
      <PanelState
        loading={applications.loading}
        error={applications.error}
        empty="No applications."
        count={rows.length}
      />
      {rows.length > 0 && (
        <ul class="pk-stack pk-stack--tight" aria-label="Your membership applications">
          {rows.map((application) => (
            <li key={application.id} class="pk-cluster">
              <Link href="/application">Application from {fmt(application.createdAt)}</Link>
              <Badge status={application.stage} label={application.stage.replaceAll("_", " ")} />
            </li>
          ))}
        </ul>
      )}
    </PanelCard>
  );
}

function OrganizationsPanel() {
  const organizations = useData(
    () => getJson("/api/v1/users/current/organizations?limit=6", userOrganizationsListResponseSchema),
    [],
  );
  const rows: UserOrganization[] = organizations.data?.organizations ?? [];

  return (
    <PanelCard title="Your organizations" viewAll={{ href: "/organizations", label: "View all" }}>
      <PanelState
        loading={organizations.loading}
        error={organizations.error}
        empty="You do not represent an organization. Individual participation works just the same."
        count={rows.length}
      />
      {rows.length > 0 && (
        <ul class="pk-stack pk-stack--tight" aria-label="Your organizations">
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
    </PanelCard>
  );
}

export function Home() {
  const session = portalSession.value;
  const isMember = Boolean(session?.member);
  const firstName = profile.value?.preferredName || profile.value?.firstName || "";

  return (
    <div class="pk pk-stack content-width-schedule">
      <p class="pk-muted">
        {firstName ? `Welcome back, ${firstName}.` : "Welcome back."} Here is what is happening in your consortium.
      </p>
      {isMember && <AttentionPanel />}
      {isMember && <MeetingsPanel />}
      <EventsPanel />
      {isMember && <VotesPanel />}
      {isMember && <ApplicationsPanel />}
      {isMember && <OrganizationsPanel />}
    </div>
  );
}
