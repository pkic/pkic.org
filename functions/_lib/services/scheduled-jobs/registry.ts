import { hasD1QueryCapacity } from "../../db/query-budget";
import { getRecordingAcquisitionConfiguration } from "../event-recordings/configuration";
import { dueRecordingAcquisitionIds } from "../event-recordings/acquisitions";
import { processRecordingAcquisition } from "../event-recordings/processor";
import {
  cleanupRecordingAcquisition,
  dueRecordingAcquisitionCleanupIds,
} from "../event-recordings/acquisition-cleanup";
import { recordingAcquisitionCleanupStorage } from "../event-recordings/acquisition-cleanup-storage";
import { runSitePublicationPipeline } from "../site-publication-runtime";
import { processPendingPromotionRenders } from "../event-agenda/promotion-render-jobs";
import { runAgendaParticipationDueWork } from "../event-participation/reconciliation";
import { runAgendaSessionReminders } from "../event-participation/reminders";
import { webPushConfiguration } from "../event-participation/web-push-configuration";
import { queueAgendaPushReminders } from "../event-participation/web-push-intents";
import { processAgendaPushOutbox } from "../event-participation/web-push-outbox";
import { runMembershipWorkflows } from "../membership/workflows/scheduled";
import { processMembershipFeeCheckouts } from "../membership/workflows/fee-checkout";
import { dispatchEventEmailCampaignPages, cleanExpiredCampaignSnapshots } from "../event-email-campaign/dispatch";
import { refreshMemberNews } from "../member-news/refresh";
import { getConfig } from "../../config";
import { runGoogleGroupsSyncPass } from "../membership/scheduled-jobs";
import { runOnHoldReminders } from "../membership/on-hold-reminders";
import { runRetentionJob } from "../retention";
import { runScheduledDueWork } from "../scheduled-due-work";
import { runSponsorshipDueWork } from "../sponsorship-scheduled-jobs";
import { runVotesDueWork } from "../votes-scheduled-jobs";
import { runWeeklyWgChairDigest } from "../wg-chair-digest";
import { runAutomaticMeetingInvitations } from "../event-series/automatic-invitations";
import { resolveAppBaseUrl } from "../../config";
import {
  boundedNextRunAt,
  earliestRetentionDue,
  earliestSponsorshipRenewalDue,
  earliestVoteTransitionDue,
} from "./next-due";
import type { ScheduledJobDefinition } from "./types";

/** Ten minutes covers the longest observed pass with room for a slow D1. */
const DEFAULT_LEASE_SECONDS = 600;
/** At most 2,000 personal outbox rows per scheduled invocation. */
const CAMPAIGN_PAGES_PER_PASS = 20;
/** One bounded transfer or verification step for each of two due acquisitions. */
const RECORDING_STEPS_PER_PASS = 2;
const RECORDING_CLEANUPS_PER_PASS = 2;
/** Conservative capacity includes claim, progress, failure and terminalization commands. */
const RECORDING_STEP_QUERY_HEADROOM = 64;

/**
 * Reconciliation floors for the deadline-driven jobs. These are the longest a
 * job may sleep when it has computed no nearer wake; the computed wake keeps
 * them timely, so the floor no longer trades latency for cost.
 */
const RETENTION_INTERVAL_SECONDS = 86_400;
const SPONSORSHIP_INTERVAL_SECONDS = 86_400;
/**
 * Votes wake at their next real deadline, so this is only the reconciliation
 * floor. It stays short because a vote deadline is user-visible: the tally
 * should be frozen promptly after the window closes.
 */
const VOTES_INTERVAL_SECONDS = 900;

/**
 * Every recurring job the platform runs, keyed by the row in
 * `scheduled_jobs`. Cadence lives in that row rather than here, so changing
 * how often a job runs is a data change instead of a deployment.
 */
export const SCHEDULED_JOB_DEFINITIONS: readonly ScheduledJobDefinition[] = [
  {
    key: "recording_acquisitions",
    leaseSeconds: DEFAULT_LEASE_SECONDS,
    requiredPermissions: ["events:manage"],
    run: async ({ env, d1QueryBudget }) => {
      const configuration = getRecordingAcquisitionConfiguration(env);
      const summary = {
        configuration: configuration ? "ready" : "unavailable",
        selected: 0,
        processed: 0,
        budgetLimited: false,
        skipped: 0,
        progress: 0,
        completed: 0,
        retrying: 0,
        failed: 0,
        lost_lease: 0,
        partsTransferred: 0,
        verifiedBytes: 0,
        cleanupSelected: 0,
        cleanupCompleted: 0,
      };
      if (!hasD1QueryCapacity(d1QueryBudget, RECORDING_STEP_QUERY_HEADROOM + 1))
        return { summary: { ...summary, budgetLimited: true } };
      const ids = configuration ? await dueRecordingAcquisitionIds(env.DB, RECORDING_STEPS_PER_PASS) : [];
      summary.selected = ids.length;
      for (const id of ids) {
        if (!hasD1QueryCapacity(d1QueryBudget, RECORDING_STEP_QUERY_HEADROOM)) {
          summary.budgetLimited = true;
          break;
        }
        if (!configuration) break;
        const result = await processRecordingAcquisition(env.DB, id, configuration);
        summary.processed++;
        summary[result.status]++;
        summary.partsTransferred += result.partsTransferred;
        summary.verifiedBytes += result.verifiedBytes;
      }
      if (env.SPEAKER_UPLOADS_BUCKET && hasD1QueryCapacity(d1QueryBudget, RECORDING_STEP_QUERY_HEADROOM + 1)) {
        const cleanupIds = await dueRecordingAcquisitionCleanupIds(env.DB, RECORDING_CLEANUPS_PER_PASS);
        summary.cleanupSelected = cleanupIds.length;
        const storage = recordingAcquisitionCleanupStorage(env.SPEAKER_UPLOADS_BUCKET);
        for (const id of cleanupIds) {
          if (!hasD1QueryCapacity(d1QueryBudget, RECORDING_STEP_QUERY_HEADROOM)) {
            summary.budgetLimited = true;
            break;
          }
          if (await cleanupRecordingAcquisition(env.DB, id, storage)) summary.cleanupCompleted++;
        }
      } else if (env.SPEAKER_UPLOADS_BUCKET) summary.budgetLimited = true;
      return { summary };
    },
  },
  {
    key: "site_publication",
    leaseSeconds: DEFAULT_LEASE_SECONDS,
    requiredPermissions: ["site:publish"],
    run: async ({ env }) => ({ summary: await runSitePublicationPipeline(env) }),
  },
  {
    key: "agenda_participation",
    leaseSeconds: DEFAULT_LEASE_SECONDS,
    requiredPermissions: ["agenda:write"],
    run: async ({ env }) => ({ summary: await runAgendaParticipationDueWork(env.DB, 10) }),
  },
  {
    key: "agenda_reminders",
    leaseSeconds: DEFAULT_LEASE_SECONDS,
    requiredPermissions: ["email:manage"],
    run: async ({ env }) => {
      const email = await runAgendaSessionReminders(env.DB, 100);
      if (!(await webPushConfiguration(env))) return { summary: email };
      const queued = await queueAgendaPushReminders(env.DB, 100);
      const push = await processAgendaPushOutbox(env.DB, env, 20);
      return { summary: { email, queued, push } };
    },
  },
  {
    key: "membership_workflows",
    leaseSeconds: DEFAULT_LEASE_SECONDS,
    requiredPermissions: ["membership:approve"],
    run: async ({ env, d1QueryBudget }) => runMembershipWorkflows(env.DB, resolveAppBaseUrl(env), d1QueryBudget),
  },
  {
    key: "membership_fee_checkouts",
    leaseSeconds: DEFAULT_LEASE_SECONDS,
    requiredPermissions: ["membership:approve"],
    run: async ({ env }) => ({ summary: await processMembershipFeeCheckouts(env.DB, env, resolveAppBaseUrl(env)) }),
  },
  {
    key: "event_email_campaigns",
    leaseSeconds: DEFAULT_LEASE_SECONDS,
    requiredPermissions: ["email:manage"],
    run: async ({ env }) => {
      const summary = await dispatchEventEmailCampaignPages(env.DB, CAMPAIGN_PAGES_PER_PASS);
      await cleanExpiredCampaignSnapshots(env.DB);
      return { summary };
    },
  },
  {
    key: "member_news_refresh",
    leaseSeconds: DEFAULT_LEASE_SECONDS,
    requiredPermissions: ["organizations:write"],
    run: async ({ env, d1QueryBudget }) => refreshMemberNews(env.DB, d1QueryBudget),
  },
  {
    key: "due_work",
    leaseSeconds: DEFAULT_LEASE_SECONDS,
    requiredPermissions: ["email:manage"],
    run: async ({ env, d1QueryBudget }) => {
      await processPendingPromotionRenders(env.DB, env, 2);
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
    key: "google_groups_sync",
    leaseSeconds: DEFAULT_LEASE_SECONDS,
    requiredPermissions: ["membership:write"],
    run: async ({ env, d1QueryBudget }) => {
      await runGoogleGroupsSyncPass(env.DB, env, getConfig(env).scheduledGoogleGroupsSyncLimit, d1QueryBudget);
    },
  },
  {
    key: "meeting_invitations",
    leaseSeconds: DEFAULT_LEASE_SECONDS,
    requiredPermissions: ["events:manage"],
    run: async ({ env, d1QueryBudget }) => {
      const { queued } = await runAutomaticMeetingInvitations(
        env.DB,
        resolveAppBaseUrl(env),
        getConfig(env).scheduledMeetingInvitationLimit,
        d1QueryBudget,
        { signingSecret: env.INTERNAL_SIGNING_SECRET, rsvpEmail: env.RSVP_EMAIL },
      );
      return { summary: { queued } };
    },
  },
  {
    key: "sponsorship_due_work",
    leaseSeconds: DEFAULT_LEASE_SECONDS,
    requiredPermissions: ["sponsorships:write"],
    run: async ({ env, d1QueryBudget }) => {
      await runSponsorshipDueWork(env.DB, env, getConfig(env).scheduledSponsorshipDueWorkLimit, d1QueryBudget);
      // Renewals are day-scale. Waking at the next actual due instant means the
      // daily reconciliation floor costs no timeliness.
      return {
        nextRunAt: boundedNextRunAt(await earliestSponsorshipRenewalDue(env.DB), SPONSORSHIP_INTERVAL_SECONDS),
      };
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
      return {
        nextRunAt: boundedNextRunAt(await earliestVoteTransitionDue(env.DB), VOTES_INTERVAL_SECONDS),
      };
    },
  },
  {
    key: "retention",
    leaseSeconds: DEFAULT_LEASE_SECONDS,
    requiredPermissions: ["retention:run", "users:anonymize"],
    run: async ({ env }) => {
      await runRetentionJob(env.DB);
      return { nextRunAt: boundedNextRunAt(await earliestRetentionDue(env.DB), RETENTION_INTERVAL_SECONDS) };
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
