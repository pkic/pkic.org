import { getConfig } from "../../config";
import {
  runConsultationBatch,
  runEcReviewBatch,
  runEcWindowAutoApprove,
  runGoogleGroupsSyncPass,
} from "../membership/scheduled-jobs";
import { runOnHoldReminders } from "../membership/on-hold-reminders";
import { runRetentionJob } from "../retention";
import { runScheduledDueWork } from "../scheduled-due-work";
import { runSponsorshipDueWork } from "../sponsorship-scheduled-jobs";
import { runVotesDueWork } from "../votes-scheduled-jobs";
import { runWeeklyWgChairDigest } from "../wg-chair-digest";
import type { ScheduledJobDefinition } from "./types";

/** Ten minutes covers the longest observed pass with room for a slow D1. */
const DEFAULT_LEASE_SECONDS = 600;

/**
 * Every recurring job the platform runs, keyed by the row in
 * `scheduled_jobs`. Cadence lives in that row rather than here, so changing
 * how often a job runs is a data change instead of a deployment.
 */
export const SCHEDULED_JOB_DEFINITIONS: readonly ScheduledJobDefinition[] = [
  {
    key: "due_work",
    leaseSeconds: DEFAULT_LEASE_SECONDS,
    requiredPermissions: ["email:manage"],
    run: async ({ env, d1QueryBudget }) => {
      await runScheduledDueWork(env, { d1QueryBudget });
    },
  },
  {
    key: "on_hold_due_work",
    leaseSeconds: DEFAULT_LEASE_SECONDS,
    requiredPermissions: ["membership:write"],
    run: async ({ env, d1QueryBudget }) => {
      await runOnHoldReminders(env.DB, env, getConfig(env).scheduledOnHoldReminderLimit, d1QueryBudget);
    },
  },
  {
    key: "ec_auto_approve",
    leaseSeconds: DEFAULT_LEASE_SECONDS,
    requiredPermissions: ["membership:approve"],
    run: async ({ env, d1QueryBudget }) => {
      await runEcWindowAutoApprove(env.DB, env, getConfig(env).scheduledEcAutoApproveLimit, d1QueryBudget);
    },
  },
  {
    key: "google_groups_sync",
    leaseSeconds: DEFAULT_LEASE_SECONDS,
    requiredPermissions: ["membership:write"],
    run: async ({ env, d1QueryBudget }) => {
      await runGoogleGroupsSyncPass(env.DB, env, getConfig(env).scheduledGoogleGroupsSyncLimit, d1QueryBudget);
    },
  },
  {
    key: "sponsorship_due_work",
    leaseSeconds: DEFAULT_LEASE_SECONDS,
    requiredPermissions: ["sponsorships:write"],
    run: async ({ env, d1QueryBudget }) => {
      await runSponsorshipDueWork(env.DB, env, getConfig(env).scheduledSponsorshipDueWorkLimit, d1QueryBudget);
    },
  },
  {
    key: "votes_due_work",
    leaseSeconds: DEFAULT_LEASE_SECONDS,
    requiredPermissions: ["votes:manage"],
    run: async ({ env, d1QueryBudget }) => {
      const config = getConfig(env);
      await runVotesDueWork(
        env.DB,
        { ...env, SCHEDULED_VOTE_NOTIFICATION_LIMIT: String(config.scheduledVoteNotificationLimit) },
        config.scheduledVoteDueWorkLimit,
        d1QueryBudget,
      );
    },
  },
  {
    key: "retention",
    leaseSeconds: DEFAULT_LEASE_SECONDS,
    requiredPermissions: ["retention:run", "users:anonymize"],
    run: async ({ env }) => {
      await runRetentionJob(env.DB);
    },
  },
  {
    key: "consultation_batch",
    leaseSeconds: DEFAULT_LEASE_SECONDS,
    requiredPermissions: ["membership:write"],
    run: async ({ env }) => {
      await runConsultationBatch(env.DB, env, getConfig(env).scheduledConsultationBatchLimit);
    },
  },
  {
    key: "ec_review_batch",
    leaseSeconds: DEFAULT_LEASE_SECONDS,
    requiredPermissions: ["membership:approve"],
    run: async ({ env }) => {
      await runEcReviewBatch(env.DB, env);
    },
  },
  {
    key: "working_group_chair_digest",
    leaseSeconds: DEFAULT_LEASE_SECONDS,
    requiredPermissions: ["membership:write"],
    run: async ({ env }) => {
      await runWeeklyWgChairDigest(env.DB, env);
    },
  },
];
