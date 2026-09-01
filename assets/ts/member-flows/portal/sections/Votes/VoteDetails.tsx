/**
 * A single vote, as a member of the owning group sees it: the question, who
 * may answer it, the ballot (one per represented Member, or one for the
 * person), and — once voting has closed — the result.
 *
 * Every state here is a sentence, not a shade. A per-Member ballot says
 * "Ballot recorded" or "Not yet voted" beside the organization it belongs to,
 * so the badge's tone repeats the words rather than carrying them.
 */
import type { MemberVote } from "../../types";
import { Badge } from "../../../../ui/Badge";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
import { isElectionResult, isMotionResult } from "./shared";
import { BallotForm } from "./BallotForm";
import { ConsultationResponseForm } from "./ConsultationForm";
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
    <div class="pk pk-stack">
      {vote.description && <p>{vote.description}</p>}
      {vote.eligibleCategories && vote.eligibleCategories.length > 0 && (
        <p class="pk-small">Eligible categories: {vote.eligibleCategories.join(", ")}</p>
      )}

      {vote.status === "open" && vote.electorateMode === "per_member" && (
        <div class="pk-stack">
          {(vote.memberBallots ?? []).map((ballot) => (
            /*
             * A Panel rather than a bordered div: the organization's name is
             * the card's heading, which the version this replaces rendered as
             * a bold span — a card per organization, and not one of them named
             * to anything navigating by heading. The ballot's state sits in
             * the header's toolbar slot, which is where the hand-written
             * `justify-content-between` row was putting it.
             */
            <Panel key={ballot.memberId}>
              <PanelHeader title={ballot.organizationName}>
                <Badge tone={ballot.hasCastBallot ? "accent" : "neutral"}>
                  {ballot.hasCastBallot ? "Ballot recorded" : "Not yet voted"}
                </Badge>
              </PanelHeader>
              <PanelBody>
                {vote.questionForm ? (
                  <ConsultationResponseForm
                    form={vote.questionForm}
                    memberId={ballot.memberId}
                    hasResponded={ballot.hasCastBallot}
                    endpoint={`${ballotEndpoint.replace(/\/ballots$/, "")}/responses`}
                    onResponded={onChanged}
                  />
                ) : (
                  <BallotForm
                    vote={vote}
                    memberId={ballot.memberId}
                    hasCastBallot={ballot.hasCastBallot}
                    endpoint={ballotEndpoint}
                    onCast={onChanged}
                  />
                )}
              </PanelBody>
            </Panel>
          ))}
          {(vote.memberBallots ?? []).length === 0 && (
            <p class="pk-small">You do not represent an eligible Member in a participating group.</p>
          )}
        </div>
      )}

      {vote.status === "open" &&
        vote.electorateMode === "per_person" &&
        (vote.canCastBallot ? (
          <div class="pk-stack pk-stack--snug">
            {vote.hasCastBallot && <p class="pk-small">You may update your ballot until voting closes.</p>}
            {vote.questionForm ? (
              <ConsultationResponseForm
                form={vote.questionForm}
                hasResponded={vote.hasCastBallot}
                endpoint={`${ballotEndpoint.replace(/\/ballots$/, "")}/responses`}
                onResponded={onChanged}
              />
            ) : (
              <BallotForm vote={vote} hasCastBallot={vote.hasCastBallot} endpoint={ballotEndpoint} onCast={onChanged} />
            )}
          </div>
        ) : (
          <p class="pk-small">You are not eligible to vote through a participating group.</p>
        ))}

      {vote.status === "scheduled" && <p class="pk-small">Voting hasn't opened yet.</p>}

      {vote.status === "closed" &&
        (vote.result ? (
          isElectionResult(vote.result) ? (
            <ElectionResultView result={vote.result} candidates={vote.candidates ?? []} />
          ) : isMotionResult(vote.result) ? (
            <MotionResultView result={vote.result} />
          ) : (
            <p class="pk-small">No result recorded.</p>
          )
        ) : (
          <p class="pk-small">Results are not available through this group.</p>
        ))}

      {vote.status === "cancelled" && (
        <p class="pk-small">This vote was cancelled{vote.cancellationReason ? `: ${vote.cancellationReason}` : "."}</p>
      )}
    </div>
  );
}
