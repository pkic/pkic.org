import type { MemberVote } from "../../types";
import { isElectionResult, isMotionResult } from "./shared";
import { BallotForm } from "./BallotForm";
import { MotionResultView, ElectionResultView } from "./VoteResults";

export function VoteDetails({
  vote,
  ballotEndpoint,
  onChanged,
}: {
  vote: MemberVote;
  ballotEndpoint: string;
  onChanged: () => Promise<void>;
}) {
  return (
    <div>
      {vote.description && <p class="mb-3">{vote.description}</p>}
      {vote.eligibleCategories && vote.eligibleCategories.length > 0 && (
        <p class="text-muted small">Eligible categories: {vote.eligibleCategories.join(", ")}</p>
      )}

      {vote.status === "open" && vote.electorateMode === "per_member" && (
        <div class="d-flex flex-column gap-3">
          {(vote.memberBallots ?? []).map((ballot) => (
            <div class="border rounded p-3" key={ballot.memberId}>
              <div class="d-flex align-items-center justify-content-between gap-2 mb-2">
                <span class="fw-semibold">{ballot.organizationName}</span>
                <span class={`badge ${ballot.hasCastBallot ? "text-bg-primary" : "text-bg-light border"}`}>
                  {ballot.hasCastBallot ? "Ballot recorded" : "Not yet voted"}
                </span>
              </div>
              <BallotForm
                vote={vote}
                memberId={ballot.memberId}
                hasCastBallot={ballot.hasCastBallot}
                endpoint={ballotEndpoint}
                onCast={onChanged}
              />
            </div>
          ))}
          {(vote.memberBallots ?? []).length === 0 && (
            <p class="text-muted small mb-0">You do not represent an eligible Member in a participating group.</p>
          )}
        </div>
      )}

      {vote.status === "open" &&
        vote.electorateMode === "per_person" &&
        (vote.canCastBallot ? (
          <div>
            {vote.hasCastBallot && <p class="text-muted small">You may update your ballot until voting closes.</p>}
            <BallotForm vote={vote} hasCastBallot={vote.hasCastBallot} endpoint={ballotEndpoint} onCast={onChanged} />
          </div>
        ) : (
          <p class="text-muted small mb-0">You are not eligible to vote through a participating group.</p>
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
          <p class="text-muted small mb-0">Results are not available through this group.</p>
        ))}

      {vote.status === "cancelled" && (
        <p class="text-muted small mb-0">
          This vote was cancelled{vote.cancellationReason ? `: ${vote.cancellationReason}` : "."}
        </p>
      )}
    </div>
  );
}
