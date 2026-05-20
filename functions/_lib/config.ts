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
    manageTokenTtlHours: parseIntOrDefault(env.MANAGE_TOKEN_TTL_HOURS, 48),
    reminderIntervalDays: parseIntOrDefault(env.REMINDER_INTERVAL_DAYS, 7),
    maxInviteReminders: parseIntOrDefault(env.MAX_INVITE_REMINDERS, 12),
    maxPresentationReminders: parseIntOrDefault(env.MAX_PRESENTATION_REMINDERS, 12),
    scheduledReminderLimit: parseIntOrDefault(env.SCHEDULED_REMINDER_LIMIT, 120),
    scheduledOutboxLimit: parseIntOrDefault(env.SCHEDULED_OUTBOX_LIMIT, 120),
    scheduledDueWorkMaxPasses: parseIntOrDefault(env.SCHEDULED_DUE_WORK_MAX_PASSES, 50),
    scheduledDueWorkMaxMs: parseIntOrDefault(env.SCHEDULED_DUE_WORK_MAX_MS, 600_000),
    scheduledDueWorkMaxSubrequests: parseIntOrDefault(env.SCHEDULED_DUE_WORK_MAX_SUBREQUESTS, 9_000),
    sendgridApiBase: env.SENDGRID_API_BASE ?? "https://api.sendgrid.com/v3/mail/send",
  };
}
