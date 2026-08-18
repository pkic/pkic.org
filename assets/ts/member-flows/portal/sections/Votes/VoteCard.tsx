import { useState } from "preact/hooks";
import { fmt, formatStageLabel } from "../../ui";
import type { PortalVote } from "../../types";
import { voteStatusBadgeClass, scopeBadgeLabel, isVotingCategory, isElectionResult, isMotionResult } from "./shared";
import { BallotForm } from "./BallotForm";
import { MotionResultView, ElectionResultView } from "./VoteResults";

export function VoteCard({
  vote,
  wgNames,
  onChanged,
}: {
  vote: PortalVote;
  wgNames: Map<string, string>;
  onChanged: () => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div class="card border-0 shadow-sm">
      <div class="card-body">
        <div class="d-flex justify-content-between align-items-start gap-3">
          <div class="flex-grow-1">
            <div class="d-flex align-items-center gap-2 flex-wrap">
              <span class="fw-semibold">{vote.title}</span>
              <span class={`badge ${voteStatusBadgeClass(vote.status)}`}>{formatStageLabel(vote.status)}</span>
              <span class="badge text-bg-light border">{formatStageLabel(vote.voteType)}</span>
              <span class="badge text-bg-light border">{scopeBadgeLabel(vote.scopeType, vote.scopeId, wgNames)}</span>
              {vote.hasCastBallot && <span class="badge text-bg-primary">You voted</span>}
            </div>
            <p class="text-muted small mb-0 mt-1">
              {vote.status === "open"
                ? `Closes ${fmt(vote.closesAt)}`
                : vote.status === "scheduled"
                  ? `Opens ${fmt(vote.opensAt)}`
                  : `Closed ${fmt(vote.closesAt)}`}
            </p>
          </div>
          <button
            type="button"
            class="btn btn-sm btn-outline-secondary flex-shrink-0"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? "Hide" : "Details"}
          </button>
        </div>

        {expanded && (
          <div class="mt-3 pt-3 border-top">
            {vote.description && <p class="mb-3">{vote.description}</p>}
            {vote.eligibleCategories && vote.eligibleCategories.length > 0 && (
              <p class="text-muted small">Eligible categories: {vote.eligibleCategories.join(", ")}</p>
            )}

            {vote.status === "open" &&
              (!isVotingCategory() ? (
                <p class="text-muted small mb-0">
                  Category H members don't cast ballots — results will be visible here once this vote closes.
                </p>
              ) : vote.hasCastBallot ? (
                <p class="text-muted small mb-0">You've cast your ballot for this round.</p>
              ) : vote.canCastBallot ? (
                <BallotForm vote={vote} onCast={onChanged} />
              ) : (
                <p class="text-muted small mb-0">
                  {vote.scopeType === "forum"
                    ? "Only your organization's voting delegate may cast this ballot."
                    : "Only members of this working group may cast a ballot."}
                </p>
              ))}

            {vote.status === "scheduled" && <p class="text-muted small mb-0">Voting hasn't opened yet.</p>}

            {vote.status === "closed" &&
              (vote.result ? (
                isElectionResult(vote.result) ? (
                  <ElectionResultView result={vote.result} candidates={vote.candidates ?? []} />
                ) : isMotionResult(vote.result) ? (
                  <MotionResultView result={vote.result} />
                ) : (
                  <p class="text-muted small mb-0">No result recorded.</p>
                )
              ) : (
                <p class="text-muted small mb-0">No result recorded.</p>
              ))}

            {vote.status === "cancelled" && <p class="text-muted small mb-0">This vote was cancelled.</p>}
          </div>
        )}
      </div>
    </div>
  );
}
