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
import { useData } from "../../../hooks/useData";
import { getJson } from "../../../shared/api-client";
import { portalSession } from "../state";
import { fmt, fmtDate, formatDateRange } from "../ui";

type MemberVote = z.infer<typeof currentUserVotesListResponseSchema>["votes"][number];

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
    <div class="card border-0 shadow-sm">
      <div class="card-header bg-white fw-semibold">{title}</div>
      <div class="card-body">
        {loading && <Spinner />}
        {!loading && error && <ErrorAlert error={error} />}
        {!loading && !error && count === 0 && <p class="text-muted small mb-0">{empty}</p>}
        {!loading && !error && count > 0 && children}
      </div>
    </div>
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
      <ul class="list-unstyled mb-0 d-flex flex-column gap-2">
        {rows.map((application) => (
          <li key={application.id} class="small">
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
      <ul class="list-unstyled mb-0 d-flex flex-column gap-2">
        {rows.map((vote: MemberVote) => (
          <li key={vote.id} class="small">
            <Link href={`/groups/${encodeURIComponent(vote.ownerGroupId)}/votes/${encodeURIComponent(vote.id)}`}>
              {vote.title}
            </Link>
            <span class="text-muted ms-2">closes {fmt(vote.closesAt)}</span>
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
      <ul class="list-unstyled mb-0 d-flex flex-column gap-2">
        {rows.map((registration) => (
          <li key={registration.id} class="small">
            <span class="fw-semibold">{registration.event.name}</span>
            <span class="text-muted ms-2">
              {formatDateRange(registration.event.startsAt, registration.event.endsAt, registration.event.timezone)}
            </span>
            <Badge status={registration.status} />
            <span class="text-muted ms-2">{label(registration.attendanceType)}</span>
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
      <ul class="list-unstyled mb-0 d-flex flex-column gap-2">
        {rows.map((donation) => (
          <li key={donation.id} class="small">
            <span class="fw-semibold">
              {donation.currency} {(donation.grossAmount / 100).toFixed(2)}
            </span>
            <Badge status={donation.status} />
            <span class="text-muted ms-2">{fmtDate(donation.createdAt)}</span>
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
      <p class="text-muted small">
        Proposal editing works through the personal access link from your proposal emails; this list is your record.
      </p>
      <ul class="list-unstyled mb-0 d-flex flex-column gap-2">
        {rows.map((proposal) => (
          <li key={proposal.id} class="small">
            <span class="fw-semibold">{proposal.title}</span>
            <span class="text-muted ms-2">{proposal.event.name}</span>
            <Badge status={proposal.status} />
            <span class="text-muted ms-2">{label(proposal.role)}</span>
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
    <div class="d-flex flex-column gap-3 content-width-md">
      <p class="text-muted small mb-0">
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
