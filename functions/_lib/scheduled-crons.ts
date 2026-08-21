/**
 * Canonical Worker cron expressions. Wrangler must repeat these strings in
 * JSON configuration, so tests/tools/scheduled-crons.test.ts enforces exact
 * production parity and prevents an implemented lane from becoming inert.
 */
export const SCHEDULED_CRONS = {
  reminders: "*/15 * * * *",
  onHoldDueWork: "2,17,32,47 * * * *",
  sponsorshipDueWork: "5,20,35,50 * * * *",
  votesDueWork: "8,23,38,53 * * * *",
  ecAutoApprove: "11,26,41,56 * * * *",
  googleGroupsSync: "14,29,44,59 * * * *",
  retention: "0 3 * * *",
  consultationBatch: "15 7 * * 1,3",
  ecReviewBatch: "15 8 * * 1,3",
  workingGroupChairDigest: "0 8 * * 1",
} as const;

export const ALL_SCHEDULED_CRONS = Object.values(SCHEDULED_CRONS);
