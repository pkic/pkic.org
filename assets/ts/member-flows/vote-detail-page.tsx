/**
 * Public vote detail Public-facing pages). Reads
 * `?slug=` from the query string and fetches GET /api/v1/votes/:slug,
 * mirroring member-detail-page.tsx's `?id=` pattern for the same reason:
 * D1 (not a build-time scan) is the source of truth, so there's no
 * per-vote static page for Hugo to generate at build time.
 *
 * The `result` shape depends on the vote's `publicDetailLevel`:
 * outcome_only carries just `{outcome}` (or, for elections with no
 * `outcome` key written server-side, `{outcome: "decided"}` — see
 * functions/_lib/services/votes.ts `publicResultForDetailLevel`);
 * aggregate/full_breakdown carry the same full shape the portal's own
 * Votes.tsx reads (`{thresholdType, counts, totalBallots, outcome}` for
 * motions/consultations, `{rounds, winnerCandidateId}` for elections).
 * This renders defensively on shape (`"rounds" in result` /
 * `"counts" in result`) rather than assuming the full shape is always
 * present.
 */
import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import { getJson, ApiClientError } from "../shared/api-client";
import { Spinner } from "../components/Spinner";
import { ErrorAlert } from "../components/ErrorAlert";
import { NotFoundPanel } from "../components/NotFoundPanel";

const API_BASE_FALLBACK = "/api/v1";

type VoteType = "election" | "motion" | "consultation";
type VoteScopeType = "forum" | "working_group";

interface VoteCandidate {
  id: string;
  candidateName: string;
}

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
  candidates: VoteCandidate[] | null;
  result: Record<string, unknown> | null;
}

const VOTE_TYPE_LABELS: Record<VoteType, string> = {
  election: "Election",
  motion: "Motion",
  consultation: "Consultation",
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function MotionResult({ result }: { result: Record<string, unknown> }) {
  const outcome = result.outcome as string | null | undefined;
  const counts = result.counts as { in_favor: number; opposed: number; abstain: number } | undefined;
  const totalBallots = result.totalBallots as number | undefined;

  return (
    <div class="mt-3">
      {outcome && (
        <span class={`badge me-2 ${outcome === "passed" ? "text-bg-success" : "text-bg-danger"}`}>
          {outcome === "passed" ? "Passed" : "Failed"}
        </span>
      )}
      {counts && (
        <span class="text-muted">
          {counts.in_favor} in favor · {counts.opposed} opposed · {counts.abstain} abstained
          {typeof totalBallots === "number" && <> ({totalBallots} ballots cast)</>}
        </span>
      )}
    </div>
  );
}

function ElectionResult({ result, candidates }: { result: Record<string, unknown>; candidates: VoteCandidate[] }) {
  const winnerCandidateId = result.winnerCandidateId as string | null | undefined;
  const rounds = result.rounds as
    { round: number; counts: Record<string, number>; eliminatedCandidateIds: string[] }[] | undefined;
  const nameOf = (id: string): string => candidates.find((c) => c.id === id)?.candidateName ?? id;

  return (
    <div class="mt-3">
      {winnerCandidateId && (
        <p class="mb-2">
          <span class="badge text-bg-success me-2">Elected</span>
          <span class="fw-semibold">{nameOf(winnerCandidateId)}</span>
        </p>
      )}
      {rounds && (
        <div class="d-flex flex-column gap-2">
          {rounds.map((round) => (
            <div key={round.round} class="small">
              <div class="text-muted">Round {round.round}</div>
              <ul class="mb-0">
                {Object.entries(round.counts).map(([candidateId, count]) => (
                  <li key={candidateId}>
                    {nameOf(candidateId)}: {count}
                    {round.eliminatedCandidateIds?.includes(candidateId) && (
                      <span class="text-muted"> (eliminated)</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function VoteResult({ vote }: { vote: PublicVote }) {
  if (vote.status !== "closed") {
    return (
      <p class="text-muted mt-3">
        Voting {vote.status === "open" ? "closes" : "opens"} {formatDate(vote.closesAt)}. Results will be published here
        once voting closes.
      </p>
    );
  }
  if (!vote.result) {
    return <p class="text-muted mt-3">Results are not yet available.</p>;
  }
  if ("rounds" in vote.result || "winnerCandidateId" in vote.result) {
    return <ElectionResult result={vote.result} candidates={vote.candidates ?? []} />;
  }
  return <MotionResult result={vote.result} />;
}

function VoteDetailView({ vote, indexHref }: { vote: PublicVote; indexHref: string }) {
  return (
    <div class="container py-4">
      <div class="d-flex gap-2 mb-2">
        <span class="badge text-bg-light border">{VOTE_TYPE_LABELS[vote.voteType]}</span>
        <span class="badge text-bg-light border">{vote.scopeType === "forum" ? "Forum" : "Working Group"}</span>
      </div>
      <h1 class="h3">{vote.title}</h1>
      {vote.description && <p class="lead">{vote.description}</p>}
      <p class="text-muted small">
        Opens {formatDate(vote.opensAt)} · Closes {formatDate(vote.closesAt)}
      </p>
      <VoteResult vote={vote} />
      <div class="mt-4">
        <a href={indexHref}>&larr; Back to all votes</a>
      </div>
    </div>
  );
}

function VoteDetailPage({ apiBase, indexHref }: { apiBase: string; indexHref: string }) {
  const [vote, setVote] = useState<PublicVote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    const slug = new URLSearchParams(window.location.search).get("slug");
    if (!slug) {
      setNotFound(true);
      return;
    }
    getJson<{ vote: PublicVote }>(`${apiBase}/votes/${encodeURIComponent(slug)}`)
      .then((data) => setVote(data.vote))
      .catch((e) => {
        if (e instanceof ApiClientError && e.status === 404) setNotFound(true);
        else setError((e as Error).message);
      });
  }, [apiBase]);

  if (notFound) {
    return <NotFoundPanel message="We couldn’t find that vote." backHref={indexHref} backLabel="Back to all votes" />;
  }
  if (error) return <ErrorAlert error={error} />;
  if (!vote) return <Spinner />;

  return <VoteDetailView vote={vote} indexHref={indexHref} />;
}

function main(): void {
  const root = document.querySelector<HTMLElement>("[data-vote-detail]");
  if (!root) return;
  const apiBase = root.dataset.apiBase ?? API_BASE_FALLBACK;
  const indexHref = root.dataset.indexHref ?? "/votes/";
  render(<VoteDetailPage apiBase={apiBase} indexHref={indexHref} />, root);
}

main();
