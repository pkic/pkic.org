import type { MemberVote, ElectionVoteResult, MotionVoteResult } from "../../types";

export const MOTION_CHOICES: { value: "in_favor" | "opposed" | "abstain"; label: string }[] = [
  { value: "in_favor", label: "In favor" },
  { value: "opposed", label: "Opposed" },
  { value: "abstain", label: "Abstain" },
];

export function isElectionResult(result: NonNullable<MemberVote["result"]>): result is ElectionVoteResult {
  return "rounds" in result;
}

export function isMotionResult(result: NonNullable<MemberVote["result"]>): result is MotionVoteResult {
  return "counts" in result;
}
