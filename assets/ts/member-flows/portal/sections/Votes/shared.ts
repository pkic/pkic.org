import { profile as profileSignal } from "../../state";
import { VOTING_CATEGORIES } from "../../../../../shared/schemas/membership-categories";
import type { PortalVote, ElectionVoteResult, MotionVoteResult } from "../../types";

export const MOTION_CHOICES: { value: "in_favor" | "opposed" | "abstain"; label: string }[] = [
  { value: "in_favor", label: "In favor" },
  { value: "opposed", label: "Opposed" },
  { value: "abstain", label: "Abstain" },
];

export function isVotingCategory(): boolean {
  const category = profileSignal.value?.membershipCategory;
  return Boolean(category && VOTING_CATEGORIES.has(category));
}

export function voteStatusBadgeClass(status: string): string {
  switch (status) {
    case "open":
      return "text-bg-success";
    case "scheduled":
      return "text-bg-info";
    case "cancelled":
      return "text-bg-danger";
    default:
      return "text-bg-secondary";
  }
}

export function proposalStatusBadgeClass(status: string): string {
  switch (status) {
    case "open_for_endorsement":
      return "text-bg-info";
    case "converted_to_vote":
      return "text-bg-success";
    case "rejected":
      return "text-bg-danger";
    default:
      return "text-bg-secondary";
  }
}

export function isElectionResult(result: NonNullable<PortalVote["result"]>): result is ElectionVoteResult {
  return "rounds" in result;
}

export function isMotionResult(result: NonNullable<PortalVote["result"]>): result is MotionVoteResult {
  return "counts" in result;
}
