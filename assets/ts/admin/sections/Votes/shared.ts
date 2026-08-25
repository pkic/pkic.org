/** Constants and small display helpers shared by the Votes and Proposals tabs. */

export const TOP_TABS = ["votes", "proposals"] as const;
export type TopTab = (typeof TOP_TABS)[number];

export const VOTE_TYPES = ["motion", "consultation", "election"] as const;
export const ELECTORATE_MODES = ["per_member", "per_person"] as const;

export const PROPOSAL_STATUS_TABS = ["open_for_endorsement", "converted_to_vote", "rejected", "withdrawn"] as const;

export function thresholdOptionsFor(voteType: string): { value: string; label: string }[] {
  if (voteType === "election") {
    return [
      { value: "simple_majority", label: "Simple majority (2 candidates)" },
      { value: "successive_elimination", label: "Successive elimination (3+ candidates)" },
    ];
  }
  return [
    { value: "simple_majority", label: "Simple majority" },
    { value: "supermajority", label: "Supermajority (2/3)" },
  ];
}

export function statusBadge(status: string): string {
  return (
    { scheduled: "text-bg-light", open: "text-bg-success", closed: "text-bg-secondary", cancelled: "text-bg-danger" }[
      status
    ] ?? "text-bg-light"
  );
}
