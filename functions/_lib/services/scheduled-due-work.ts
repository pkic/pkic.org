import { getConfig } from "../config";
import { processPendingOutbox } from "../email/outbox";
import { runReminderCycle } from "./reminders";
import { runRsvpEnforcer } from "./rsvp-enforcer";
import { runWaitlistPromotionCycle } from "./registrations/waitlist-promotions";
import { processPendingStorageDeletions, type StorageDeletionResult } from "./storage-deletion-outbox";
import type { Env } from "../types";
import type { D1QueryBudget } from "../db/query-budget";

type ReminderCycleResult = Awaited<ReturnType<typeof runReminderCycle>>;
type OutboxResult = Awaited<ReturnType<typeof processPendingOutbox>>;
type RsvpEnforcementResult = Awaited<ReturnType<typeof runRsvpEnforcer>>;
type WaitlistPromotionResult = Awaited<ReturnType<typeof runWaitlistPromotionCycle>>;

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

function didPassReachWorkLimit(
  reminders: ReminderCycleTotals,
  waitlistPromotions: WaitlistPromotionResult,
  outbox: OutboxResult,
  storageDeletions: StorageDeletionResult,
  rsvp: RsvpEnforcementResult,
  limits: { scheduledReminderLimit: number; scheduledOutboxLimit: number; scheduledStorageDeletionLimit: number },
): boolean {
  const filledReminderBatch = reminders.processed >= limits.scheduledReminderLimit;
  const filledOutboxBatch = outbox.processed >= limits.scheduledOutboxLimit;
  const filledStorageDeletionBatch =
    storageDeletions.processed + storageDeletions.failed >= limits.scheduledStorageDeletionLimit;
  const promotedWaitlist = waitlistPromotions.dayRegistrationOffers > 0;
  const rsvpQueuedEmails = rsvp.warningsSent + rsvp.downgradesProcessed;
  const rsvpProcessedWork = rsvp.bouncesProcessed + rsvpQueuedEmails;
  return (
    filledReminderBatch || filledOutboxBatch || filledStorageDeletionBatch || promotedWaitlist || rsvpProcessedWork > 0
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
  const rsvpEnforcement: RsvpEnforcementResult = { bouncesProcessed: 0, warningsSent: 0, downgradesProcessed: 0 };
  const outbox: OutboxResult = { processed: 0, failed: 0 };
  const storageDeletions: StorageDeletionResult = { processed: 0, failed: 0 };
  const passes: ScheduledDueWorkPass[] = [];
  const passDurations: number[] = [];
  const passD1Queries: number[] = [];
  const initialD1Queries = invocationBudget?.d1QueryBudget?.usedQueries() ?? 0;
  let stoppedReason: ScheduledDueWorkResult["stoppedReason"] = "max_passes";

  for (let pass = 1; pass <= config.scheduledDueWorkMaxPasses; pass++) {
    const estimatedNextPassMs = estimateNextPassMs(passDurations);
    const estimatedNextD1Queries = estimateNextPassD1Queries(passD1Queries);
    if (!hasTimeForAnotherPass(deadline - Date.now(), estimatedNextPassMs)) {
      stoppedReason = "time_limit";
      break;
    }
    const remainingD1Queries = invocationBudget?.d1QueryBudget?.remainingQueries() ?? Number.POSITIVE_INFINITY;
    if (!hasD1BudgetForAnotherPass(remainingD1Queries, estimatedNextD1Queries)) {
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
    const waitlistPass = await runWaitlistPromotionCycle(env.DB, {
      appBaseUrl: config.appBaseUrl,
      claimWindowHours: config.waitlistClaimWindowHours,
      limit: config.scheduledWaitlistPromotionLimit,
    });
    const rsvpPass = await runRsvpEnforcer(env.DB, env);
    const outboxPass = await processPendingOutbox(env.DB, env, config.scheduledOutboxLimit);
    const storageDeletionPass = await processPendingStorageDeletions(env.DB, env, config.scheduledStorageDeletionLimit);
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

    passes.push({
      pass,
      reminders: cycleTotals,
      waitlistPromotions: waitlistPass,
      rsvpEnforcement: rsvpPass,
      outbox: outboxPass,
      storageDeletions: storageDeletionPass,
      durationMs,
      elapsedMs,
      remainingBudgetMs: Math.max(0, deadline - Date.now()),
      d1Queries: passQueryCount,
      remainingD1Queries: invocationBudget?.d1QueryBudget?.remainingQueries() ?? null,
    });

    if (
      !didPassReachWorkLimit(cycleTotals, waitlistPass, outboxPass, storageDeletionPass, rsvpPass, {
        scheduledReminderLimit: config.scheduledReminderLimit,
        scheduledOutboxLimit: config.scheduledOutboxLimit,
        scheduledStorageDeletionLimit: config.scheduledStorageDeletionLimit,
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
  };
}
