import { BALLOT_CHOICES } from "../../../../../shared/schemas/votes";
import type { MemberVote, ElectionVoteResult, MotionVoteResult } from "../../types";

type BallotChoice = (typeof BALLOT_CHOICES)[number];

/** How each choice reads on a ballot. The set itself belongs to the contract. */
const BALLOT_CHOICE_LABELS: Record<BallotChoice, string> = {
  in_favor: "In favor",
  opposed: "Opposed",
  abstain: "Abstain",
};

export const MOTION_CHOICES: { value: BallotChoice; label: string }[] = BALLOT_CHOICES.map((value) => ({
  value,
  label: BALLOT_CHOICE_LABELS[value],
}));

export function isElectionResult(result: NonNullable<MemberVote["result"]>): result is ElectionVoteResult {
  return "rounds" in result;
}

export function isMotionResult(result: NonNullable<MemberVote["result"]>): result is MotionVoteResult {
  return "counts" in result;
}
