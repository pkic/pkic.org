import { AppError } from "../../errors";
import type { ThresholdType, VoteType } from "./shared";

export interface VoteConfiguration {
  voteType: VoteType;
  thresholdType: ThresholdType;
  candidateCount: number;
  opensAt: string;
  closesAt: string;
}

export function validateVoteWindow(opensAt: string, closesAt: string): void {
  const opensAtTime = new Date(opensAt).getTime();
  const closesAtTime = new Date(closesAt).getTime();
  if (!Number.isFinite(opensAtTime) || !Number.isFinite(closesAtTime) || closesAtTime <= opensAtTime) {
    throw new AppError(422, "INVALID_WINDOW", "closesAt must be after opensAt");
  }
}

export function validateVoteConfiguration(configuration: VoteConfiguration): void {
  const { voteType, thresholdType, candidateCount, opensAt, closesAt } = configuration;
  if (voteType === "election") {
    if (candidateCount < 2) {
      throw new AppError(422, "CANDIDATES_REQUIRED", "Election votes require at least 2 candidates");
    }
    if (thresholdType === "successive_elimination" && candidateCount < 3) {
      throw new AppError(
        422,
        "INVALID_THRESHOLD",
        "successive_elimination requires at least 3 candidates; use simple_majority for 2-candidate elections",
      );
    }
    if (thresholdType === "supermajority") {
      throw new AppError(422, "INVALID_THRESHOLD", "supermajority does not apply to elections");
    }
  } else if (thresholdType === "successive_elimination") {
    throw new AppError(422, "INVALID_THRESHOLD", "successive_elimination only applies to elections");
  }
  validateVoteWindow(opensAt, closesAt);
}

/** Election proposals cannot be converted safely until proposal candidates are modeled. */
export function requireSupportedVoteProposalType(voteType: VoteType): void {
  if (voteType === "election") {
    throw new AppError(
      422,
      "ELECTION_PROPOSAL_UNSUPPORTED",
      "Election proposals require candidate authoring and are not supported yet; create the election directly.",
    );
  }
}
