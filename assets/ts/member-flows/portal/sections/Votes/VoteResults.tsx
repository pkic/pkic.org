import { useCallback } from "preact/hooks";
import type { VoteCandidate, ElectionVoteResult, MotionVoteResult } from "../../types";
import { Badge } from "../../../../components/Badge";
import { Badge as ToneBadge } from "../../../../ui/Badge";
// `pk-answer-list` is defined in Content.css, which ships in a lazy chunk, so
// the module that writes the class name has to import the stylesheet itself.
import "../../../../ui/Content.css";

export function MotionResultView({ result }: { result: MotionVoteResult }) {
  return (
    <div class="pk pk-stack pk-stack--tight">
      {/* The cluster's gap separates the outcome pill from the tally, so the
          pill no longer carries a margin of its own. */}
      <div class="pk-cluster">
        <Badge status={result.outcome} />
        <span class="pk-small">
          {result.counts.in_favor} in favor · {result.counts.opposed} opposed · {result.counts.abstain} abstained (
          {result.totalBallots} ballots cast)
        </span>
      </div>
      {result.quorum && (
        <p class="pk-small">
          Turnout {result.totalBallots} of {result.quorum.eligible} eligible; {result.quorum.percent}% required{" "}
          {result.quorum.required} {result.quorum.required === 1 ? "ballot" : "ballots"}.
        </p>
      )}
      {result.castingVote && (
        <p class="pk-small">
          Tied, settled by the {result.castingVote.role === "lead" ? "chair" : "vice chair"}&rsquo;s deciding vote
          {result.castingVote.choice === "in_favor" ? " in favor" : " against"}.
        </p>
      )}
    </div>
  );
}

export function ElectionResultView({
  result,
  candidates,
}: {
  result: ElectionVoteResult;
  candidates: VoteCandidate[];
}) {
  const nameOf = useCallback((id: string) => candidates.find((c) => c.id === id)?.candidateName ?? id, [candidates]);
  const winner = result.winnerCandidateId ? nameOf(result.winnerCandidateId) : null;

  return (
    <div class="pk pk-stack pk-stack--snug">
      {winner && (
        <p class="pk-cluster">
          {/* The tone carries the outcome and the word "Elected" says it, so
              the result does not rest on the green alone. */}
          <ToneBadge tone="ok">Elected</ToneBadge>
          <span class="pk-strong">{winner}</span>
        </p>
      )}
      <div class="pk-stack pk-stack--snug">
        {result.rounds.map((round) => (
          // The round label is a heading, not a muted div: it names the list
          // under it, so the tallies are reachable as structure rather than as
          // an unlabeled list among several identical ones.
          <div key={round.round} class="pk-small">
            <h6 class="pk-muted">Round {round.round}</h6>
            <ul class="pk-answer-list">
              {Object.entries(round.counts).map(([candidateId, count]) => (
                <li key={candidateId}>
                  {nameOf(candidateId)}: {count}
                  {round.eliminatedCandidateIds.includes(candidateId) && <span class="pk-muted"> (eliminated)</span>}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
