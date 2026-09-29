/**
 * Canonical Worker cron expressions. Wrangler must repeat these strings in
 * JSON configuration, so tests/tools/scheduled-crons.test.ts enforces exact
 * production parity and prevents an implemented lane from becoming inert.
 *
 * There is one expression. Individual job cadence lives in the
 * `scheduled_jobs` registry, so changing how often a job runs is a data
 * change rather than a deployment, and adding a job needs no new trigger.
 */
export const SCHEDULED_CRONS = {
  dispatcher: "* * * * *",
} as const;

export const ALL_SCHEDULED_CRONS = Object.values(SCHEDULED_CRONS);
