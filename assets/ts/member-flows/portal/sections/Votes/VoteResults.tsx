import { useCallback } from "preact/hooks";
import type { VoteCandidate, ElectionVoteResult, MotionVoteResult } from "../../types";

const MOTION_OUTCOME_BADGE: Record<MotionVoteResult["outcome"], { label: string; className: string }> = {
  passed: { label: "Passed", className: "text-bg-success" },
  failed: { label: "Failed", className: "text-bg-danger" },
  // Not a rejection: too few members took part for the question to be
  // settled, which is what the reader needs to know before re-running it.
  not_quorate: { label: "Not decided — turnout too low", className: "text-bg-warning" },
};

export function MotionResultView({ result }: { result: MotionVoteResult }) {
  const badge = MOTION_OUTCOME_BADGE[result.outcome];
  return (
    <div>
      <span class={`badge me-2 ${badge.className}`}>{badge.label}</span>
      <span class="text-muted small">
        {result.counts.in_favor} in favor · {result.counts.opposed} opposed · {result.counts.abstain} abstained (
        {result.totalBallots} ballots cast)
      </span>
      {result.quorum && (
        <div class="text-muted small">
          Turnout {result.totalBallots} of {result.quorum.eligible} eligible; {result.quorum.percent}% required{" "}
          {result.quorum.required} {result.quorum.required === 1 ? "ballot" : "ballots"}.
        </div>
      )}
      {result.castingVote && (
        <div class="text-muted small">
          Tied, settled by the {result.castingVote.role === "lead" ? "chair" : "vice chair"}&rsquo;s deciding vote
          {result.castingVote.choice === "in_favor" ? " in favor" : " against"}.
        </div>
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
    <div>
      {winner && (
        <p class="mb-2">
          <span class="badge text-bg-success me-2">Elected</span>
          <span class="fw-semibold">{winner}</span>
        </p>
      )}
      <div class="d-flex flex-column gap-2">
        {result.rounds.map((round) => (
          <div key={round.round} class="small">
            <div class="text-muted">Round {round.round}</div>
            <ul class="mb-0">
              {Object.entries(round.counts).map(([candidateId, count]) => (
                <li key={candidateId}>
                  {nameOf(candidateId)}: {count}
                  {round.eliminatedCandidateIds.includes(candidateId) && <span class="text-muted"> (eliminated)</span>}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
