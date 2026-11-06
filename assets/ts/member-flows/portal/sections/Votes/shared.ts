import { BALLOT_CHOICE_LABELS, BALLOT_CHOICES } from "../../../../../shared/schemas/votes";
import type { MemberVote, ElectionVoteResult, MotionVoteResult } from "../../types";

type BallotChoice = (typeof BALLOT_CHOICES)[number];

/** A motion choice in words; an unknown value is shown as stored. */
export function ballotChoiceLabel(choice: string): string {
  return BALLOT_CHOICE_LABELS[choice as BallotChoice] ?? choice;
}

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
