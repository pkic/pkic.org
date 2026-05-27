import { getConfig } from "../config";
import { processPendingOutbox } from "../email/outbox";
import { runReminderCycle } from "./reminders";
import { runRsvpEnforcer } from "./rsvp-enforcer";
import type { Env } from "../types";

type ReminderCycleResult = Awaited<ReturnType<typeof runReminderCycle>>;
type OutboxResult = Awaited<ReturnType<typeof processPendingOutbox>>;
type RsvpEnforcementResult = Awaited<ReturnType<typeof runRsvpEnforcer>>;

const ESTIMATED_OUTBOX_SUBREQUESTS_PER_EMAIL = 7;
const ESTIMATED_RSVP_SUBREQUESTS_PER_ITEM = 4;
const ESTIMATED_REMINDER_SCHEDULING_BASE_SUBREQUESTS = 12;
const ESTIMATED_REMINDER_SCHEDULING_BATCH_SIZE = 250;

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
  rsvpEnforcement: RsvpEnforcementResult;
  outbox: OutboxResult;
  durationMs: number;
  elapsedMs: number;
  remainingBudgetMs: number;
  estimatedSubrequests: number;
  remainingSubrequestBudget: number;
}

export interface ScheduledDueWorkResult {
  passes: ScheduledDueWorkPass[];
  stoppedReason: "caught_up" | "max_passes" | "time_limit" | "subrequest_limit";
  elapsedMs: number;
  estimatedNextPassMs: number | null;
  estimatedSubrequests: number;
  estimatedNextPassSubrequests: number | null;
  reminders: ReminderCycleTotals;
  rsvpEnforcement: RsvpEnforcementResult;
  outbox: OutboxResult;
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

function addOutboxTotals(total: OutboxResult, next: OutboxResult): void {
  total.processed += next.processed;
  total.failed += next.failed;
}

function didPassReachWorkLimit(
  reminders: ReminderCycleTotals,
  outbox: OutboxResult,
  rsvp: RsvpEnforcementResult,
  limits: { scheduledReminderLimit: number; scheduledOutboxLimit: number },
): boolean {
  const filledReminderBatch = reminders.processed >= limits.scheduledReminderLimit;
  const filledOutboxBatch = outbox.processed >= limits.scheduledOutboxLimit;
  const rsvpQueuedEmails = rsvp.warningsSent + rsvp.downgradesProcessed;
  const rsvpProcessedWork = rsvp.bouncesProcessed + rsvpQueuedEmails;
  return filledReminderBatch || filledOutboxBatch || rsvpProcessedWork > 0;
}

function estimateNextPassMs(passDurations: number[]): number | null {
  if (passDurations.length === 0) {
    return null;
  }

  return Math.max(...passDurations);
}

function estimateQueuedReminderEmails(reminders: ReminderCycleTotals): number {
  return (
    reminders.inviteRemindersQueued +
    reminders.speakerInviteRemindersQueued +
    reminders.presentationRemindersQueued +
    reminders.confirmationRemindersQueued
  );
}

function estimatePassSubrequests(
  reminders: ReminderCycleTotals,
  rsvp: RsvpEnforcementResult,
  outbox: OutboxResult,
): number {
  const reminderEmails = estimateQueuedReminderEmails(reminders);
  const reminderSchedulingSubrequests =
    reminderEmails > 0
      ? ESTIMATED_REMINDER_SCHEDULING_BASE_SUBREQUESTS +
        Math.ceil(reminderEmails / ESTIMATED_REMINDER_SCHEDULING_BATCH_SIZE)
      : 0;
  const rsvpWork = rsvp.bouncesProcessed + rsvp.warningsSent + rsvp.downgradesProcessed;

  return (
    reminderSchedulingSubrequests +
    rsvpWork * ESTIMATED_RSVP_SUBREQUESTS_PER_ITEM +
    outbox.processed * ESTIMATED_OUTBOX_SUBREQUESTS_PER_EMAIL
  );
}

function estimateNextPassSubrequests(passSubrequests: number[]): number | null {
  if (passSubrequests.length === 0) {
    return null;
  }

  return Math.max(...passSubrequests);
}

function hasTimeForAnotherPass(remainingBudgetMs: number, estimatedNextPassMs: number | null): boolean {
  if (estimatedNextPassMs === null) {
    return remainingBudgetMs > 0;
  }

  const safetyBufferMs = Math.max(5_000, Math.ceil(estimatedNextPassMs * 0.15));
  return remainingBudgetMs > estimatedNextPassMs + safetyBufferMs;
}

function hasSubrequestBudgetForAnotherPass(
  remainingBudget: number,
  estimatedNextPassSubrequests: number | null,
): boolean {
  if (estimatedNextPassSubrequests === null) {
    return remainingBudget > 0;
  }

  const safetyBuffer = Math.max(250, Math.ceil(estimatedNextPassSubrequests * 0.1));
  return remainingBudget > estimatedNextPassSubrequests + safetyBuffer;
}

export async function runScheduledDueWork(env: Env): Promise<ScheduledDueWorkResult> {
  const config = getConfig(env);
  const startedAt = Date.now();
  const deadline = startedAt + config.scheduledDueWorkMaxMs;
  const reminders = emptyReminderCycleTotals();
  const rsvpEnforcement: RsvpEnforcementResult = { bouncesProcessed: 0, warningsSent: 0, downgradesProcessed: 0 };
  const outbox: OutboxResult = { processed: 0, failed: 0 };
  const passes: ScheduledDueWorkPass[] = [];
  const passDurations: number[] = [];
  const passSubrequests: number[] = [];
  let estimatedSubrequests = 0;
  let stoppedReason: ScheduledDueWorkResult["stoppedReason"] = "max_passes";

  for (let pass = 1; pass <= config.scheduledDueWorkMaxPasses; pass++) {
    const estimatedNextPassMs = estimateNextPassMs(passDurations);
    const estimatedNextSubrequests = estimateNextPassSubrequests(passSubrequests);
    if (!hasTimeForAnotherPass(deadline - Date.now(), estimatedNextPassMs)) {
      stoppedReason = "time_limit";
      break;
    }
    if (
      !hasSubrequestBudgetForAnotherPass(
        config.scheduledDueWorkMaxSubrequests - estimatedSubrequests,
        estimatedNextSubrequests,
      )
    ) {
      stoppedReason = "subrequest_limit";
      break;
    }

    const passStartedAt = Date.now();
    const cycle = await runReminderCycle(env.DB, {
      appBaseUrl: config.appBaseUrl,
      reminderIntervalDays: config.reminderIntervalDays,
      pendingConfirmationReminderIntervalDays: config.pendingConfirmationReminderIntervalDays,
      maxInviteReminders: config.maxInviteReminders,
      maxPendingConfirmationReminders: config.maxPendingConfirmationReminders,
      maxPresentationReminders: config.maxPresentationReminders,
      limit: config.scheduledReminderLimit,
    });
    const cycleTotals = summarizeReminderCycle(cycle);
    const rsvpPass = await runRsvpEnforcer(env.DB, env);
    const outboxPass = await processPendingOutbox(env.DB, env, config.scheduledOutboxLimit);
    const durationMs = Date.now() - passStartedAt;
    const elapsedMs = Date.now() - startedAt;
    const estimatedPassSubrequests = estimatePassSubrequests(cycleTotals, rsvpPass, outboxPass);

    passDurations.push(durationMs);
    passSubrequests.push(estimatedPassSubrequests);
    estimatedSubrequests += estimatedPassSubrequests;
    addReminderCycleTotals(reminders, cycleTotals);
    addRsvpEnforcementTotals(rsvpEnforcement, rsvpPass);
    addOutboxTotals(outbox, outboxPass);

    passes.push({
      pass,
      reminders: cycleTotals,
      rsvpEnforcement: rsvpPass,
      outbox: outboxPass,
      durationMs,
      elapsedMs,
      remainingBudgetMs: Math.max(0, deadline - Date.now()),
      estimatedSubrequests: estimatedPassSubrequests,
      remainingSubrequestBudget: Math.max(0, config.scheduledDueWorkMaxSubrequests - estimatedSubrequests),
    });

    if (
      !didPassReachWorkLimit(cycleTotals, outboxPass, rsvpPass, {
        scheduledReminderLimit: config.scheduledReminderLimit,
        scheduledOutboxLimit: config.scheduledOutboxLimit,
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
    estimatedSubrequests,
    estimatedNextPassSubrequests: estimateNextPassSubrequests(passSubrequests),
    reminders,
    rsvpEnforcement,
    outbox,
  };
}
