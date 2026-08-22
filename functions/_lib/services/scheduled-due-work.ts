import { getConfig } from "../config";
import { processPendingOutbox } from "../email/outbox";
import { runReminderCycle } from "./reminders";
import { runRsvpEnforcer } from "./rsvp-enforcer";
import { runWaitlistPromotionCycle } from "./registrations/waitlist-promotions";
import { processPendingStorageDeletions, type StorageDeletionResult } from "./storage-deletion-outbox";
import { processPendingBadgeRenders, type BadgeRenderResult } from "./registration-badge-regeneration";
import { drainOrganizationContentReviewNotificationIntents } from "./organization-content";
import type { Env } from "../types";
import type { D1QueryBudget } from "../db/query-budget";

type ReminderCycleResult = Awaited<ReturnType<typeof runReminderCycle>>;
type OutboxResult = Awaited<ReturnType<typeof processPendingOutbox>>;
type RsvpEnforcementResult = Awaited<ReturnType<typeof runRsvpEnforcer>>;
type WaitlistPromotionResult = Awaited<ReturnType<typeof runWaitlistPromotionCycle>>;

// The notification drain is deliberately opportunistic in this shared pass.
// Keep room for the normal outbox, storage-deletion, and badge-render
// selection statements that follow it, even when the invocation-wide D1
// budget is nearly exhausted by the earlier reminder/RSVP/waitlist work.
const NOTIFICATION_DRAIN_DOWNSTREAM_D1_RESERVE = 4;

interface ReminderCycleTotals {
  inviteRemindersQueued: number;
  speakerInviteRemindersQueued: number;
  presentationRemindersQueued: number;
  confirmationRemindersQueued: number;
  confirmationCancellationsProcessed: number;
  processed: number;
}

interface ScheduledDueWorkPass {
  pass: number;
  reminders: ReminderCycleTotals;
  waitlistPromotions: WaitlistPromotionResult;
  rsvpEnforcement: RsvpEnforcementResult;
  outbox: OutboxResult;
  storageDeletions: StorageDeletionResult;
  badgeRenders: BadgeRenderResult;
  durationMs: number;
  elapsedMs: number;
  remainingBudgetMs: number;
  d1Queries: number;
  remainingD1Queries: number | null;
}

export interface ScheduledDueWorkResult {
  passes: ScheduledDueWorkPass[];
  stoppedReason: "caught_up" | "max_passes" | "time_limit" | "d1_query_limit";
  elapsedMs: number;
  estimatedNextPassMs: number | null;
  d1Queries: number;
  estimatedNextPassD1Queries: number | null;
  reminders: ReminderCycleTotals;
  waitlistPromotions: WaitlistPromotionResult;
  rsvpEnforcement: RsvpEnforcementResult;
  outbox: OutboxResult;
  storageDeletions: StorageDeletionResult;
  badgeRenders: BadgeRenderResult;
}

function emptyReminderCycleTotals(): ReminderCycleTotals {
  return {
    inviteRemindersQueued: 0,
    speakerInviteRemindersQueued: 0,
    presentationRemindersQueued: 0,
    confirmationRemindersQueued: 0,
    confirmationCancellationsProcessed: 0,
    processed: 0,
  };
}

function summarizeReminderCycle(reminders: ReminderCycleResult): ReminderCycleTotals {
  return {
    inviteRemindersQueued: reminders.inviteRemindersQueued,
    speakerInviteRemindersQueued: reminders.speakerInviteRemindersQueued,
    presentationRemindersQueued: reminders.presentationRemindersQueued,
    confirmationRemindersQueued: reminders.confirmationRemindersQueued,
    confirmationCancellationsProcessed: reminders.confirmationCancellationsProcessed,
    processed: reminders.processed,
  };
}

function addReminderCycleTotals(total: ReminderCycleTotals, next: ReminderCycleTotals): void {
  total.inviteRemindersQueued += next.inviteRemindersQueued;
  total.speakerInviteRemindersQueued += next.speakerInviteRemindersQueued;
  total.presentationRemindersQueued += next.presentationRemindersQueued;
  total.confirmationRemindersQueued += next.confirmationRemindersQueued;
  total.confirmationCancellationsProcessed += next.confirmationCancellationsProcessed;
  total.processed += next.processed;
}

function addRsvpEnforcementTotals(total: RsvpEnforcementResult, next: RsvpEnforcementResult): void {
  total.bouncesProcessed += next.bouncesProcessed;
  total.warningsSent += next.warningsSent;
  total.downgradesProcessed += next.downgradesProcessed;
  total.ignored += next.ignored;
  total.examined += next.examined;
  total.limitReached ||= next.limitReached;
}

function emptyWaitlistPromotionTotals(): WaitlistPromotionResult {
  return {
    eventsScanned: 0,
    dayRegistrationOffers: 0,
    affectedRegistrations: 0,
    outboxIds: [],
  };
}

function addWaitlistPromotionTotals(total: WaitlistPromotionResult, next: WaitlistPromotionResult): void {
  total.eventsScanned += next.eventsScanned;
  total.dayRegistrationOffers += next.dayRegistrationOffers;
  total.affectedRegistrations += next.affectedRegistrations;
  total.outboxIds.push(...next.outboxIds);
}

function addOutboxTotals(total: OutboxResult, next: OutboxResult): void {
  total.processed += next.processed;
  total.failed += next.failed;
}

function addStorageDeletionTotals(total: StorageDeletionResult, next: StorageDeletionResult): void {
  total.processed += next.processed;
  total.failed += next.failed;
}

function addBadgeRenderTotals(total: BadgeRenderResult, next: BadgeRenderResult): void {
  total.processed += next.processed;
  total.failed += next.failed;
}

function didPassReachWorkLimit(
  reminders: ReminderCycleTotals,
  waitlistPromotions: WaitlistPromotionResult,
  outbox: OutboxResult,
  storageDeletions: StorageDeletionResult,
  badgeRenders: BadgeRenderResult,
  rsvp: RsvpEnforcementResult,
  limits: {
    scheduledReminderLimit: number;
    scheduledOutboxLimit: number;
    scheduledStorageDeletionLimit: number;
    scheduledBadgeRenderLimit: number;
  },
): boolean {
  const filledReminderBatch = limits.scheduledReminderLimit > 0 && reminders.processed >= limits.scheduledReminderLimit;
  const filledOutboxBatch = limits.scheduledOutboxLimit > 0 && outbox.processed >= limits.scheduledOutboxLimit;
  const filledStorageDeletionBatch =
    limits.scheduledStorageDeletionLimit > 0 &&
    storageDeletions.processed + storageDeletions.failed >= limits.scheduledStorageDeletionLimit;
  const filledBadgeRenderBatch =
    limits.scheduledBadgeRenderLimit > 0 &&
    badgeRenders.processed + badgeRenders.failed >= limits.scheduledBadgeRenderLimit;
  const promotedWaitlist = waitlistPromotions.dayRegistrationOffers > 0;
  const rsvpQueuedEmails = rsvp.warningsSent + rsvp.downgradesProcessed;
  const rsvpProcessedWork = rsvp.bouncesProcessed + rsvp.ignored + rsvpQueuedEmails;
  return (
    filledReminderBatch ||
    filledOutboxBatch ||
    filledStorageDeletionBatch ||
    filledBadgeRenderBatch ||
    promotedWaitlist ||
    rsvpProcessedWork > 0 ||
    rsvp.limitReached
  );
}

function estimateNextPassMs(passDurations: number[]): number | null {
  if (passDurations.length === 0) {
    return null;
  }

  return Math.max(...passDurations);
}

function estimateNextPassD1Queries(passQueries: number[]): number | null {
  if (passQueries.length === 0) {
    return null;
  }

  return Math.max(...passQueries);
}

function hasTimeForAnotherPass(remainingBudgetMs: number, estimatedNextPassMs: number | null): boolean {
  if (estimatedNextPassMs === null) {
    return remainingBudgetMs > 0;
  }

  const safetyBufferMs = Math.max(5_000, Math.ceil(estimatedNextPassMs * 0.15));
  return remainingBudgetMs > estimatedNextPassMs + safetyBufferMs;
}

function hasD1BudgetForAnotherPass(remainingBudget: number, estimatedNextPassQueries: number | null): boolean {
  if (estimatedNextPassQueries === null) {
    return remainingBudget > 0;
  }

  const safetyBuffer = Math.max(25, Math.ceil(estimatedNextPassQueries * 0.1));
  return remainingBudget > estimatedNextPassQueries + safetyBuffer;
}

export interface ScheduledDueWorkBudget {
  deadlineAt?: number;
  d1QueryBudget?: D1QueryBudget;
}

export async function runScheduledDueWork(
  env: Env,
  invocationBudget?: ScheduledDueWorkBudget,
): Promise<ScheduledDueWorkResult> {
  const config = getConfig(env);
  const startedAt = Date.now();
  // The local cap protects direct/manual callers. When dispatched by the
  // shared cron registry, its invocation-wide deadline is authoritative so
  // this first (and largest) job cannot consume time reserved for every
  // sibling that follows it.
  const deadline = Math.min(
    startedAt + config.scheduledDueWorkMaxMs,
    invocationBudget?.deadlineAt ?? Number.POSITIVE_INFINITY,
  );
  const reminders = emptyReminderCycleTotals();
  const waitlistPromotions = emptyWaitlistPromotionTotals();
  const rsvpEnforcement: RsvpEnforcementResult = {
    bouncesProcessed: 0,
    warningsSent: 0,
    downgradesProcessed: 0,
    ignored: 0,
    examined: 0,
    limitReached: false,
  };
  const outbox: OutboxResult = { processed: 0, failed: 0 };
  const storageDeletions: StorageDeletionResult = { processed: 0, failed: 0 };
  const badgeRenders: BadgeRenderResult = { processed: 0, failed: 0 };
  const passes: ScheduledDueWorkPass[] = [];
  const passDurations: number[] = [];
  const passD1Queries: number[] = [];
  let remainingBadgeRenderAllowance = config.scheduledBadgeRenderLimit;
  const initialD1Queries = invocationBudget?.d1QueryBudget?.usedQueries() ?? 0;
  let stoppedReason: ScheduledDueWorkResult["stoppedReason"] = "max_passes";

  for (let pass = 1; pass <= config.scheduledDueWorkMaxPasses; pass++) {
    const estimatedNextPassMs = estimateNextPassMs(passDurations);
    const estimatedNextD1Queries = estimateNextPassD1Queries(passD1Queries);
    if (!hasTimeForAnotherPass(deadline - Date.now(), estimatedNextPassMs)) {
      stoppedReason = "time_limit";
      break;
    }
    const remainingD1QueriesForPass = invocationBudget?.d1QueryBudget?.remainingQueries() ?? Number.POSITIVE_INFINITY;
    if (!hasD1BudgetForAnotherPass(remainingD1QueriesForPass, estimatedNextD1Queries)) {
      stoppedReason = "d1_query_limit";
      break;
    }

    const passStartedAt = Date.now();
    const passStartedD1Queries = invocationBudget?.d1QueryBudget?.usedQueries() ?? 0;
    const cycle = await runReminderCycle(env.DB, {
      appBaseUrl: config.appBaseUrl,
      reminderIntervalDays: config.reminderIntervalDays,
      pendingConfirmationReminderIntervalDays: config.pendingConfirmationReminderIntervalDays,
      confirmationLinkTtlHours: config.confirmationLinkTtlHours,
      maxInviteReminders: config.maxInviteReminders,
      maxPendingConfirmationReminders: config.maxPendingConfirmationReminders,
      maxPresentationReminders: config.maxPresentationReminders,
      presentationReminderLeadDays: config.presentationReminderLeadDays,
      limit: config.scheduledReminderLimit,
    });
    const cycleTotals = summarizeReminderCycle(cycle);
    const rsvpPass = await runRsvpEnforcer(env.DB, env, invocationBudget?.d1QueryBudget?.remainingQueries());
    const waitlistPass = await runWaitlistPromotionCycle(env.DB, {
      appBaseUrl: config.appBaseUrl,
      claimWindowHours: config.waitlistClaimWindowHours,
      limit: config.scheduledWaitlistPromotionLimit,
    });
    // Reviewer intents are durable independently of request/background
    // execution. Drain a bounded batch before the normal outbox processor so
    // a failed waitUntil callback is recovered by the existing 15-minute due
    // work lane. One read plus one bulk-insert and one mark statement are the
    // minimum D1 cost, so reserve those queries before entering the drain.
    const notificationRemainingD1Queries =
      invocationBudget?.d1QueryBudget?.remainingQueries() ?? Number.POSITIVE_INFINITY;
    const notificationLimit = Math.min(
      config.scheduledOutboxLimit,
      invocationBudget?.d1QueryBudget
        ? Math.floor(Math.max(0, notificationRemainingD1Queries - NOTIFICATION_DRAIN_DOWNSTREAM_D1_RESERVE - 1) / 2)
        : config.scheduledOutboxLimit,
    );
    if (notificationLimit > 0) {
      await drainOrganizationContentReviewNotificationIntents(env.DB, notificationLimit);
    }
    const outboxPass = await processPendingOutbox(env.DB, env, config.scheduledOutboxLimit);
    const storageDeletionPass = await processPendingStorageDeletions(env.DB, env, config.scheduledStorageDeletionLimit);
    const badgeRenderPassLimit = remainingBadgeRenderAllowance;
    const badgeRenderPass = await processPendingBadgeRenders(env.DB, env, badgeRenderPassLimit);
    remainingBadgeRenderAllowance = Math.max(
      0,
      remainingBadgeRenderAllowance - badgeRenderPass.processed - badgeRenderPass.failed,
    );
    const durationMs = Date.now() - passStartedAt;
    const elapsedMs = Date.now() - startedAt;
    const passQueryCount = (invocationBudget?.d1QueryBudget?.usedQueries() ?? 0) - passStartedD1Queries;

    passDurations.push(durationMs);
    passD1Queries.push(passQueryCount);
    addReminderCycleTotals(reminders, cycleTotals);
    addWaitlistPromotionTotals(waitlistPromotions, waitlistPass);
    addRsvpEnforcementTotals(rsvpEnforcement, rsvpPass);
    addOutboxTotals(outbox, outboxPass);
    addStorageDeletionTotals(storageDeletions, storageDeletionPass);
    addBadgeRenderTotals(badgeRenders, badgeRenderPass);

    passes.push({
      pass,
      reminders: cycleTotals,
      waitlistPromotions: waitlistPass,
      rsvpEnforcement: rsvpPass,
      outbox: outboxPass,
      storageDeletions: storageDeletionPass,
      badgeRenders: badgeRenderPass,
      durationMs,
      elapsedMs,
      remainingBudgetMs: Math.max(0, deadline - Date.now()),
      d1Queries: passQueryCount,
      remainingD1Queries: invocationBudget?.d1QueryBudget?.remainingQueries() ?? null,
    });

    if (
      !didPassReachWorkLimit(cycleTotals, waitlistPass, outboxPass, storageDeletionPass, badgeRenderPass, rsvpPass, {
        scheduledReminderLimit: config.scheduledReminderLimit,
        scheduledOutboxLimit: config.scheduledOutboxLimit,
        scheduledStorageDeletionLimit: config.scheduledStorageDeletionLimit,
        scheduledBadgeRenderLimit: remainingBadgeRenderAllowance > 0 ? badgeRenderPassLimit : 0,
      })
    ) {
      stoppedReason = "caught_up";
      break;
    }
  }

  if (stoppedReason === "max_passes" && Date.now() >= deadline) {
    stoppedReason = "time_limit";
  }

  return {
    passes,
    stoppedReason,
    elapsedMs: Date.now() - startedAt,
    estimatedNextPassMs: estimateNextPassMs(passDurations),
    d1Queries: (invocationBudget?.d1QueryBudget?.usedQueries() ?? 0) - initialD1Queries,
    estimatedNextPassD1Queries: estimateNextPassD1Queries(passD1Queries),
    reminders,
    waitlistPromotions,
    rsvpEnforcement,
    outbox,
    storageDeletions,
    badgeRenders,
  };
}
