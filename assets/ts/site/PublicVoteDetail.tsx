import { formatDateTime } from "../../shared/format-date";
import { StatusBadge } from "./StatusBadge";
import { Badge } from "../ui/Badge";
import type { PublicVoteGetResponse } from "../../shared/schemas/votes";
import { Markdown } from "../ui/Markdown";

type PublicVote = PublicVoteGetResponse["vote"];
type VoteType = PublicVote["voteType"];
type VoteCandidate = NonNullable<PublicVote["candidates"]>[number];
type VoteResult = NonNullable<PublicVote["result"]>;
type ElectionResultData = Extract<VoteResult, { rounds: unknown[] }>;
type MotionResultData = Exclude<VoteResult, ElectionResultData>;

export const VOTE_TYPE_LABELS: Record<VoteType, string> = {
  election: "Election",
  motion: "Motion",
  consultation: "Consultation",
};

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
        {formatDateTime(vote.status === "open" ? vote.closesAt : vote.opensAt)}. Results will be published here once
        voting closes.
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
        {vote.description && <Markdown className="pk-lede" markdown={vote.description} />}
        <p class="pk-small">
          Opens {formatDateTime(vote.opensAt)} · Closes {formatDateTime(vote.closesAt)}
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
