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
import { Badge as StatusBadge } from "../components/Badge";
import { Badge } from "../ui/Badge";
import { publicVoteGetResponseSchema, type PublicVoteGetResponse } from "../../shared/schemas/votes";

const API_BASE_FALLBACK = "/api/v1";

type PublicVote = PublicVoteGetResponse["vote"];
type VoteType = PublicVote["voteType"];
type VoteCandidate = NonNullable<PublicVote["candidates"]>[number];
type VoteResult = NonNullable<PublicVote["result"]>;
type ElectionResultData = Extract<VoteResult, { rounds: unknown[] }>;
type MotionResultData = Exclude<VoteResult, ElectionResultData>;

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

function MotionResult({ result }: { result: MotionResultData }) {
  // A consultation result carries no outcome at all — it gathers preference
  // rather than deciding anything — so read it defensively rather than
  // assuming every result shape has one.
  const outcome = "outcome" in result ? result.outcome : undefined;
  const counts = "counts" in result ? result.counts : undefined;
  const totalBallots = "totalBallots" in result ? result.totalBallots : undefined;

  return (
    <div class="pk-cluster">
      {/*
       * The product's own status vocabulary rather than a hand-written pair of
       * words. The version this replaces read `outcome === "passed" ? "Passed"
       * : "Failed"`, which labelled `not_quorate` — a vote that decided
       * nothing because too few people took part — as a defeat. `statusLabel`
       * calls it what it is, and the tone arrives with a dot, so the outcome
       * never rests on colour alone.
       */}
      {outcome && <StatusBadge status={outcome} />}
      {counts && (
        <span class="pk-muted">
          {counts.in_favor} in favor · {counts.opposed} opposed · {counts.abstain} abstained
          {typeof totalBallots === "number" && <> ({totalBallots} ballots cast)</>}
        </span>
      )}
    </div>
  );
}

function ElectionResult({ result, candidates }: { result: ElectionResultData; candidates: VoteCandidate[] }) {
  const { winnerCandidateId, rounds } = result;
  const nameOf = (id: string): string => candidates.find((c) => c.id === id)?.candidateName ?? id;

  return (
    <div class="pk-stack pk-stack--snug">
      {winnerCandidateId && (
        <div class="pk-cluster">
          <Badge tone="ok">Elected</Badge>
          <span class="pk-strong">{nameOf(winnerCandidateId)}</span>
        </div>
      )}
      {rounds && (
        <div class="pk-stack pk-stack--snug">
          {rounds.map((round) => (
            <div key={round.round} class="pk-stack pk-stack--tight pk-small">
              <div class="pk-strong">Round {round.round}</div>
              <ul>
                {Object.entries(round.counts).map(([candidateId, count]) => (
                  <li key={candidateId}>
                    {nameOf(candidateId)}: {count}
                    {/*
                     * Plain text, not a muted span: the whole round block is
                     * already muted, so the old `text-muted` here distinguished
                     * nothing — and elimination is information, which should
                     * not have been carried by a shade in the first place.
                     */}
                    {round.eliminatedCandidateIds?.includes(candidateId) && <> (eliminated)</>}
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
  if (vote.status === "cancelled") {
    return (
      <p class="pk-muted">This vote was cancelled{vote.cancellationReason ? `: ${vote.cancellationReason}` : "."}</p>
    );
  }
  if (vote.status !== "closed") {
    return (
      <p class="pk-muted">
        Voting {vote.status === "open" ? "closes" : "opens"}{" "}
        {formatDate(vote.status === "open" ? vote.closesAt : vote.opensAt)}. Results will be published here once voting
        closes.
      </p>
    );
  }
  if (!vote.result) {
    return <p class="pk-muted">Results are not yet available.</p>;
  }
  if ("rounds" in vote.result) {
    return <ElectionResult result={vote.result} candidates={vote.candidates ?? []} />;
  }
  return <MotionResult result={vote.result} />;
}

export function VoteDetailView({ vote, indexHref }: { vote: PublicVote; indexHref: string }) {
  return (
    <div class="pk pk-container pk-section pk-stack">
      {/*
       * Three facts about the vote, not three statuses, so they carry no tone
       * dot. Each gets a hidden term: "Policy Group" and "Per Member" say
       * nothing on their own to a reader who meets the badge row without its
       * visual context.
       */}
      <div class="pk-cluster">
        <Badge tone="neutral" dot={false}>
          <span class="pk-sr-only">Vote type: </span>
          {VOTE_TYPE_LABELS[vote.voteType]}
        </Badge>
        <Badge tone="neutral" dot={false}>
          <span class="pk-sr-only">Held by: </span>
          {vote.ownerGroupName}
        </Badge>
        <Badge tone="neutral" dot={false}>
          <span class="pk-sr-only">Electorate: </span>
          {vote.electorateMode === "per_member" ? "Per Member" : "Per person"}
        </Badge>
      </div>
      <div class="pk-stack pk-stack--tight">
        <h1>{vote.title}</h1>
        {vote.description && <p class="pk-lede">{vote.description}</p>}
        <p class="pk-small">
          Opens {formatDate(vote.opensAt)} · Closes {formatDate(vote.closesAt)}
        </p>
      </div>
      <VoteResult vote={vote} />
      {/* Inside a paragraph so the link box is the width of its own words
          rather than the full column, as NotFoundPanel's back link is. */}
      <p>
        <a href={indexHref}>&larr; Back to all votes</a>
      </p>
    </div>
  );
}

export function VoteDetailPage({ apiBase, indexHref }: { apiBase: string; indexHref: string }) {
  const [vote, setVote] = useState<PublicVote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    const slug = new URLSearchParams(window.location.search).get("slug");
    if (!slug) {
      setNotFound(true);
      return;
    }
    getJson(`${apiBase}/votes/${encodeURIComponent(slug)}`, publicVoteGetResponseSchema)
      .then((response) => setVote(response.vote))
      .catch((e) => {
        if (e instanceof ApiClientError && e.status === 404) setNotFound(true);
        else setError((e as Error).message);
      });
  }, [apiBase]);

  if (notFound) {
    return <NotFoundPanel message="We couldn’t find that vote." backHref={indexHref} backLabel="Back to all votes" />;
  }
  if (error) return <ErrorAlert error={error} />;
  // Named, so the wait says what is loading rather than announcing a bare
  // "Loading…" on a page that is otherwise empty.
  if (!vote) return <Spinner label="Loading vote…" />;

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
