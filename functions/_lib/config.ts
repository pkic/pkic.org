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

function toBranchAliasOrigin(branch: string | undefined, pagesUrl: string | undefined): string | null {
  if (!branch || !pagesUrl) {
    return null;
  }

  try {
    const parsed = new URL(pagesUrl);
    const hostParts = parsed.hostname.split(".");
    if (hostParts.length < 3) {
      return null;
    }

    return `${parsed.protocol}//${branch}.${hostParts.slice(1).join(".")}`;
  } catch {
    return null;
  }
}

export function resolveAppBaseUrl(env: Pick<Env, "CF_PAGES_URL" | "CF_PAGES_BRANCH" | "APP_BASE_URL">): string {
  // APP_BASE_URL takes precedence (set in .dev.vars for local development).
  // CF_PAGES_BRANCH resolves branch aliases like https://events.pkic.pages.dev.
  // CF_PAGES_URL is set automatically by Cloudflare Pages in all deployed environments.
  return toOrigin(env.APP_BASE_URL)
    ?? toBranchAliasOrigin(env.CF_PAGES_BRANCH, env.CF_PAGES_URL)
    ?? toOrigin(env.CF_PAGES_URL)
    ?? "http://localhost";
}

export function getConfig(env: Env, request?: Request) {
  return {
    appBaseUrl: resolveAppBaseUrl(env),
    minProposalReviews: parseIntOrDefault(env.DEFAULT_MIN_PROPOSAL_REVIEWS, 2),
    referralCodeLength: parseIntOrDefault(env.DEFAULT_REFERRAL_CODE_LENGTH, 7),
    inviteLimitPerAttendee: parseIntOrDefault(env.DEFAULT_INVITE_LIMIT_PER_ATTENDEE, 5),
    waitlistClaimWindowHours: parseIntOrDefault(env.WAITLIST_CLAIM_WINDOW_HOURS, 24),
    magicLinkTtlMinutes: parseIntOrDefault(env.MAGIC_LINK_TTL_MINUTES, 15),
    manageTokenTtlHours: parseIntOrDefault(env.MANAGE_TOKEN_TTL_HOURS, 48),
    reminderIntervalDays: parseIntOrDefault(env.REMINDER_INTERVAL_DAYS, 7),
    maxInviteReminders: parseIntOrDefault(env.MAX_INVITE_REMINDERS, 12),
    maxPresentationReminders: parseIntOrDefault(env.MAX_PRESENTATION_REMINDERS, 12),
    sendgridApiBase: env.SENDGRID_API_BASE,
    emailLayoutR2Key: env.EMAIL_LAYOUT_R2_KEY ?? "layouts/email/default.html",
  };
}
