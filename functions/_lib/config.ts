import type { Env } from "./types";

function parseIntOrDefault(value: string | undefined, defaultValue: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

export const DEFAULT_RSVP_INBOUND_EMAIL_MAX_BYTES = 5 * 1024 * 1024;

export function getRsvpInboundEmailMaxBytes(env: Pick<Env, "RSVP_INBOUND_EMAIL_MAX_BYTES">): number {
  return Math.min(
    25 * 1024 * 1024,
    Math.max(64 * 1024, parseIntOrDefault(env.RSVP_INBOUND_EMAIL_MAX_BYTES, DEFAULT_RSVP_INBOUND_EMAIL_MAX_BYTES)),
  );
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
    scheduledStorageDeletionLimit: parseIntOrDefault(env.SCHEDULED_STORAGE_DELETION_LIMIT, 25),
    scheduledWaitlistPromotionLimit: parseIntOrDefault(env.SCHEDULED_WAITLIST_PROMOTION_LIMIT, 120),
    scheduledDueWorkMaxPasses: parseIntOrDefault(env.SCHEDULED_DUE_WORK_MAX_PASSES, 50),
    scheduledDueWorkMaxMs: parseIntOrDefault(env.SCHEDULED_DUE_WORK_MAX_MS, 600_000),
    // D1 allows a finite number of statements per Worker invocation and
    // counts each statement in batch(). Keep explicit headroom for logging
    // and platform/runtime behavior rather than attempting to infer this
    // from row counts or HTTP subrequests.
    scheduledD1QueryBudget: Math.min(950, Math.max(1, parseIntOrDefault(env.SCHEDULED_D1_QUERY_BUDGET, 900))),
    scheduledOnHoldReminderLimit: parseIntOrDefault(env.SCHEDULED_ON_HOLD_REMINDER_LIMIT, 100),
    scheduledEcAutoApproveLimit: parseIntOrDefault(env.SCHEDULED_EC_AUTO_APPROVE_LIMIT, 100),
    scheduledSponsorshipDueWorkLimit: parseIntOrDefault(env.SCHEDULED_SPONSORSHIP_DUE_WORK_LIMIT, 100),
    scheduledVoteNotificationLimit: parseIntOrDefault(env.SCHEDULED_VOTE_NOTIFICATION_LIMIT, 100),
    adminCampaignMaxRecipients: Math.min(
      10_000,
      Math.max(1, parseIntOrDefault(env.ADMIN_CAMPAIGN_MAX_RECIPIENTS, 2_000)),
    ),
    sendgridApiBase: env.SENDGRID_API_BASE ?? "https://api.sendgrid.com/v3/mail/send",
  };
}
