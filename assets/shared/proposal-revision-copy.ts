/**
 * A proposal the program committee sent back for changes. The proposer
 * revises it at their own pace: saving keeps a draft, and only resubmitting
 * starts the next review round.
 */
export const PROPOSAL_REVISION_COPY = {
  title: "The program committee asked for changes",
  /** Said when the committee left no note, which the decision contract otherwise requires. */
  noNote: "Revise your proposal and resubmit it for review.",
  draftHelp: "Save your changes as often as you like. Reviewers see them only after you resubmit for review.",
  save: "Save draft",
  resubmit: "Resubmit for review",
  saved: "Draft saved. Resubmit for review when you are ready.",
  resubmitted: "Proposal resubmitted for review.",
} as const;
