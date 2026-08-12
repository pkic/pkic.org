/**
 * Public votes index (Public-facing pages). A Hugo
 * static shell that fetches GET /api/v1/votes (already filtered server-side
 * to visibility='public') and lists them grouped by status, mirroring the
 * member-directory-page.tsx pattern: one client-side fetch per page load,
 * no per-vote static page since D1 (not a build-time scan) is the source
 * of truth.
 *
 * Links to the detail page use a query-string slug
 * (`/votes/detail/?slug=`), not a real `/votes/:slug` path — Hugo can't
 * generate one static page per D1 vote at build time, the same reasoning
 * member-detail-page.tsx documents for `/members/profile/?id=`.
 */
import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import { getJson } from "../shared/api-client";
import { Spinner } from "../components/Spinner";
import { ErrorAlert } from "../components/ErrorAlert";

const API_BASE_FALLBACK = "/api/v1";
const FETCH_LIMIT = 100;

type VoteType = "election" | "motion" | "consultation";
type VoteScopeType = "forum" | "working_group";

interface PublicVote {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  voteType: VoteType;
  scopeType: VoteScopeType;
  opensAt: string;
  closesAt: string;
  status: string;
}

interface PublicVotesResponse {
  votes: PublicVote[];
  total: number;
}

const VOTE_TYPE_LABELS: Record<VoteType, string> = {
  election: "Election",
  motion: "Motion",
  consultation: "Consultation",
};

function statusBadgeClass(status: string): string {
  switch (status) {
    case "open":
      return "text-bg-success";
    case "scheduled":
      return "text-bg-info";
    default:
      return "text-bg-secondary";
  }
}

function scopeLabel(scopeType: VoteScopeType): string {
  return scopeType === "forum" ? "Forum" : "Working Group";
}

function VoteCard({ vote, detailBase }: { vote: PublicVote; detailBase: string }) {
  const href = `${detailBase}?slug=${encodeURIComponent(vote.slug)}`;
  return (
    <div class="member-card bento-card">
      <a class="stretched-link" href={href} aria-label={vote.title}></a>
      <div class="d-flex gap-2 mb-2">
        <span class={`badge ${statusBadgeClass(vote.status)}`}>
          {vote.status.charAt(0).toUpperCase() + vote.status.slice(1)}
        </span>
        <span class="badge text-bg-light border">{VOTE_TYPE_LABELS[vote.voteType]}</span>
        <span class="badge text-bg-light border">{scopeLabel(vote.scopeType)}</span>
      </div>
      <div class="member-card-name">{vote.title}</div>
      {vote.description && (
        <p class="member-card-description">
          {vote.description.length > 160 ? `${vote.description.slice(0, 160).trimEnd()}…` : vote.description}
        </p>
      )}
      <p class="text-muted small mb-0">
        {vote.status === "closed" ? "Closed " : "Closes "}
        {new Date(vote.closesAt).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}
      </p>
    </div>
  );
}

function VotesIndex({ apiBase, detailBase }: { apiBase: string; detailBase: string }) {
  const [votes, setVotes] = useState<PublicVote[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getJson<PublicVotesResponse>(`${apiBase}/votes?per_page=${FETCH_LIMIT}&sort=closes_at`)
      .then((data) => setVotes(data.votes))
      .catch((e) => setError((e as Error).message));
  }, [apiBase]);

  if (error) return <ErrorAlert error={error} />;
  if (!votes) return <Spinner />;

  const open = votes.filter((v) => v.status === "open" || v.status === "scheduled");
  const closed = votes.filter((v) => v.status === "closed");

  if (votes.length === 0) {
    return <p class="text-muted fst-italic text-center mt-3">No public vote results are available yet.</p>;
  }

  return (
    <div class="container-fluid px-2 px-md-4 pb-5">
      {open.length > 0 && (
        <section class="mb-5">
          <h3 class="member-letter-heading">Open for voting</h3>
          <div class="members-grid">
            {open.map((v) => (
              <VoteCard key={v.id} vote={v} detailBase={detailBase} />
            ))}
          </div>
        </section>
      )}
      {closed.length > 0 && (
        <section>
          <h3 class="member-letter-heading">Closed</h3>
          <div class="members-grid">
            {closed.map((v) => (
              <VoteCard key={v.id} vote={v} detailBase={detailBase} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function main(): void {
  const root = document.querySelector<HTMLElement>("[data-votes-index]");
  if (!root) return;
  const apiBase = root.dataset.apiBase ?? API_BASE_FALLBACK;
  const detailBase = root.dataset.detailBase ?? "/votes/detail/";
  render(<VotesIndex apiBase={apiBase} detailBase={detailBase} />, root);
}

main();
