import type { Env } from "./types";

function parseIntOrDefault(value: string | undefined, defaultValue: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

function toOrigin(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function toRequestOrigin(request: Request | undefined): string | null {
  if (!request) {
    return null;
  }

  try {
    return new URL(request.url).origin;
  } catch {
    return null;
  }
}

function missingAppBaseUrlError(): Error {
  return new Error("APP_BASE_URL is required when request URL is unavailable");
}

export function resolveAppBaseUrl(env: Pick<Env, "APP_BASE_URL">, request?: Request): string {
  const configuredOrigin = toOrigin(env.APP_BASE_URL);
  if (configuredOrigin) {
    return configuredOrigin;
  }

  const requestOrigin = toRequestOrigin(request);
  if (requestOrigin) {
    return requestOrigin;
  }

  throw missingAppBaseUrlError();
}

export function getConfig(env: Env, request?: Request) {
  return {
    appBaseUrl: resolveAppBaseUrl(env, request),
    minProposalReviews: parseIntOrDefault(env.DEFAULT_MIN_PROPOSAL_REVIEWS, 2),
    referralCodeLength: parseIntOrDefault(env.DEFAULT_REFERRAL_CODE_LENGTH, 7),
    inviteLimitPerAttendee: parseIntOrDefault(env.DEFAULT_INVITE_LIMIT_PER_ATTENDEE, 50),
    inviteLimitSpeakerNomination: parseIntOrDefault(env.DEFAULT_INVITE_LIMIT_SPEAKER_NOMINATION, 10),
    waitlistClaimWindowHours: parseIntOrDefault(env.WAITLIST_CLAIM_WINDOW_HOURS, 24),
    magicLinkTtlMinutes: parseIntOrDefault(env.MAGIC_LINK_TTL_MINUTES, 15),
    confirmationLinkTtlHours: parseIntOrDefault(env.CONFIRMATION_LINK_TTL_HOURS, 48),
    reminderIntervalDays: parseIntOrDefault(env.REMINDER_INTERVAL_DAYS, 7),
    pendingConfirmationReminderIntervalDays: parseIntOrDefault(env.PENDING_CONFIRMATION_REMINDER_INTERVAL_DAYS, 1),
    maxInviteReminders: parseIntOrDefault(env.MAX_INVITE_REMINDERS, 12),
    maxPendingConfirmationReminders: parseIntOrDefault(env.MAX_PENDING_CONFIRMATION_REMINDERS, 12),
    maxPresentationReminders: parseIntOrDefault(env.MAX_PRESENTATION_REMINDERS, 12),
    presentationReminderLeadDays: Math.min(
      36500,
      Math.max(0, parseIntOrDefault(env.PRESENTATION_REMINDER_LEAD_DAYS, 60)),
    ),
    scheduledReminderLimit: parseIntOrDefault(env.SCHEDULED_REMINDER_LIMIT, 120),
    scheduledOutboxLimit: parseIntOrDefault(env.SCHEDULED_OUTBOX_LIMIT, 120),
    scheduledWaitlistPromotionLimit: parseIntOrDefault(env.SCHEDULED_WAITLIST_PROMOTION_LIMIT, 120),
    scheduledDueWorkMaxPasses: parseIntOrDefault(env.SCHEDULED_DUE_WORK_MAX_PASSES, 50),
    scheduledDueWorkMaxMs: parseIntOrDefault(env.SCHEDULED_DUE_WORK_MAX_MS, 600_000),
    scheduledDueWorkMaxSubrequests: parseIntOrDefault(env.SCHEDULED_DUE_WORK_MAX_SUBREQUESTS, 9_000),
    // Shared budget for the REMINDER_CRON job registry (functions/router.ts)
    // that dispatches runScheduledDueWork + the sibling membership/
    // sponsorship/votes due-work jobs — leaves headroom before the next
    // 15-minute cron tick fires. Per-pass item limits below bound each
    // individual job's own query so no single pass can scan an unbounded
    // due-row set (PR #1 review §9.1).
    reminderCronBudgetMs: parseIntOrDefault(env.REMINDER_CRON_BUDGET_MS, 780_000),
    scheduledOnHoldReminderLimit: parseIntOrDefault(env.SCHEDULED_ON_HOLD_REMINDER_LIMIT, 100),
    scheduledEcAutoApproveLimit: parseIntOrDefault(env.SCHEDULED_EC_AUTO_APPROVE_LIMIT, 100),
    scheduledSponsorshipDueWorkLimit: parseIntOrDefault(env.SCHEDULED_SPONSORSHIP_DUE_WORK_LIMIT, 100),
    sendgridApiBase: env.SENDGRID_API_BASE ?? "https://api.sendgrid.com/v3/mail/send",
  };
}
