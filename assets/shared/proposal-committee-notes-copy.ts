/**
 * The proposal's private notes for the program committee: context reviewers
 * need that does not belong in the published abstract.
 */
export const PROPOSAL_COMMITTEE_NOTES_COPY = {
  label: "Notes for the program committee (optional)",
  help: "Only reviewers and organizers see these notes; they are never published. Keep the abstract complete on its own.",
  reviewTitle: "Notes for the program committee",
  reviewHelp: "Private to reviewers and organizers. Never published.",
  /** Shown to the proposer once the proposal is accepted or declined. */
  locked: "Locked now that the proposal has been decided.",
} as const;
