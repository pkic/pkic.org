/**
 * The identity's complete participation record — the histories behind the
 * dashboard's attention items. Every panel is a bounded self-scoped server
 * page; record types without a member capacity requirement stay visible to
 * any authenticated identity, per the identity-first participation decision.
 */
import { Link } from "wouter";
import type { z } from "zod";
import { currentUserDonationsListResponseSchema } from "../../../../shared/schemas/current-user-donations";
import { currentUserProposalsListResponseSchema } from "../../../../shared/schemas/current-user-proposals";
import { currentUserRegistrationsListResponseSchema } from "../../../../shared/schemas/current-user-registrations";
import { myApplicationsListResponseSchema } from "../../../../shared/schemas/me";
import { currentUserVotesListResponseSchema } from "../../../../shared/schemas/votes";
import { Badge } from "../../../components/Badge";
import { ErrorAlert } from "../../../components/ErrorAlert";
import { Spinner } from "../../../components/Spinner";
import { EmptyState } from "../../../ui/EmptyState";
import { Panel, PanelBody, PanelHeader } from "../../../ui/Panel";
import { useData } from "../../../hooks/useData";
import { getJson } from "../../../shared/api-client";
import { portalSession } from "../state";
import { fmt, fmtDate, formatDateRange } from "../ui";

type MemberVote = z.infer<typeof currentUserVotesListResponseSchema>["votes"][number];

/**
 * One record history, as a titled panel.
 *
 * The three states a panel can be in — loading, failed, empty — are each
 * announced rather than merely drawn: `Spinner` and `EmptyState` carry
 * `role="status"`, `ErrorAlert` an alert region. The rhythm between the
 * panel's own children is the body's `gap`, so nothing inside carries a
 * margin of its own.
 */
function RecordCard({
  title,
  loading,
  error,
  empty,
  count,
  children,
}: {
  title: string;
  loading: boolean;
  error: string | null;
  empty: string;
  count: number;
  children?: preact.ComponentChildren;
}) {
  return (
    <Panel>
      <PanelHeader title={title} />
      <PanelBody class="pk-stack pk-stack--snug">
        {loading && <Spinner label={`Loading ${title.toLowerCase()}…`} />}
        {!loading && error && <ErrorAlert error={error} />}
        {!loading && !error && count === 0 && <EmptyState title={empty} />}
        {!loading && !error && count > 0 && children}
      </PanelBody>
    </Panel>
  );
}

function ApplicationsCard() {
  const applications = useData(
    () => getJson("/api/v1/users/current/applications?limit=25", myApplicationsListResponseSchema),
    [],
  );
  const rows = applications.data?.applications ?? [];
  return (
    <RecordCard
      title="Membership applications"
      loading={applications.loading}
      error={applications.error}
      empty="No membership applications."
      count={rows.length}
    >
      {/* A list of records with no name is announced as "list", and this page
          renders five of them. */}
      <ul class="pk-stack pk-stack--tight" aria-label="Membership applications">
        {rows.map((application) => (
          <li key={application.id} class="pk-cluster">
            <Link href="/application">Application from {fmt(application.createdAt)}</Link>
            <Badge status={application.stage} />
          </li>
        ))}
      </ul>
    </RecordCard>
  );
}

function BallotHistoryCard() {
  const votes = useData(
    () => getJson("/api/v1/users/current/votes?limit=25&sort=-closes_at", currentUserVotesListResponseSchema),
    [],
  );
  const rows = (votes.data?.votes ?? []).filter((vote) => vote.hasCastBallot || vote.canCastBallot);
  return (
    <RecordCard
      title="Votes"
      loading={votes.loading}
      error={votes.error}
      empty="No votes involve your capacities yet."
      count={rows.length}
    >
      <ul class="pk-stack pk-stack--tight" aria-label="Votes">
        {rows.map((vote: MemberVote) => (
          <li key={vote.id} class="pk-cluster">
            <Link href={`/groups/${encodeURIComponent(vote.ownerGroupId)}/votes/${encodeURIComponent(vote.id)}`}>
              {vote.title}
            </Link>
            <span class="pk-small">closes {fmt(vote.closesAt)}</span>
            {/* The badge says "Voted" or "Not voted yet" in words, so whether a
                ballot is cast never rests on the tone alone. */}
            {vote.hasCastBallot ? (
              <Badge status="completed" label="Voted" />
            ) : (
              <Badge status="pending" label="Not voted yet" />
            )}
          </li>
        ))}
      </ul>
    </RecordCard>
  );
}

function label(value: string): string {
  return value.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}

function RegistrationsCard() {
  const registrations = useData(
    () => getJson("/api/v1/users/current/registrations?limit=25", currentUserRegistrationsListResponseSchema),
    [],
  );
  const rows = registrations.data?.registrations ?? [];
  return (
    <RecordCard
      title="Event registrations"
      loading={registrations.loading}
      error={registrations.error}
      empty="No event registrations yet."
      count={rows.length}
    >
      <ul class="pk-stack pk-stack--tight" aria-label="Event registrations">
        {rows.map((registration) => (
          <li key={registration.id} class="pk-cluster">
            <span class="pk-strong">{registration.event.name}</span>
            <span class="pk-small">
              {formatDateRange(registration.event.startsAt, registration.event.endsAt, registration.event.timezone)}
            </span>
            <Badge status={registration.status} />
            <span class="pk-small">{label(registration.attendanceType)}</span>
            {registration.waitlisted && <Badge status="waitlisted" />}
          </li>
        ))}
      </ul>
    </RecordCard>
  );
}

function DonationsCard() {
  const donations = useData(
    () => getJson("/api/v1/users/current/donations?limit=25", currentUserDonationsListResponseSchema),
    [],
  );
  const rows = donations.data?.donations ?? [];
  return (
    <RecordCard
      title="Donations"
      loading={donations.loading}
      error={donations.error}
      empty="No donations recorded for your verified email."
      count={rows.length}
    >
      <ul class="pk-stack pk-stack--tight" aria-label="Donations">
        {rows.map((donation) => (
          <li key={donation.id} class="pk-cluster">
            <span class="pk-strong">
              {donation.currency} {(donation.grossAmount / 100).toFixed(2)}
            </span>
            <Badge status={donation.status} />
            <span class="pk-small">{fmtDate(donation.createdAt)}</span>
          </li>
        ))}
      </ul>
    </RecordCard>
  );
}

function ProposalsCard() {
  const proposals = useData(
    () => getJson("/api/v1/users/current/proposals?limit=25", currentUserProposalsListResponseSchema),
    [],
  );
  const rows = proposals.data?.proposals ?? [];
  return (
    <RecordCard
      title="Event proposals"
      loading={proposals.loading}
      error={proposals.error}
      empty="No event proposals are linked to your account."
      count={rows.length}
    >
      <p class="pk-muted pk-small">
        Proposal editing works through the personal access link from your proposal emails; this list is your record.
      </p>
      <ul class="pk-stack pk-stack--tight" aria-label="Event proposals">
        {rows.map((proposal) => (
          <li key={proposal.id} class="pk-cluster">
            <span class="pk-strong">{proposal.title}</span>
            <span class="pk-small">{proposal.event.name}</span>
            <Badge status={proposal.status} />
            <span class="pk-small">{label(proposal.role)}</span>
          </li>
        ))}
      </ul>
    </RecordCard>
  );
}

export function Participation() {
  const session = portalSession.value;
  const isMember = Boolean(session?.member);

  return (
    <div class="pk pk-stack content-width-md">
      <p class="pk-muted pk-small">
        Your record across the consortium. Active items that need a decision also appear on{" "}
        <Link href="/home">Home</Link>.
      </p>
      <RegistrationsCard />
      {isMember && <BallotHistoryCard />}
      <ProposalsCard />
      <DonationsCard />
      {isMember && <ApplicationsCard />}
    </div>
  );
}
