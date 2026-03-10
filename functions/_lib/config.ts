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

export function resolveAppBaseUrl(env: Pick<Env, "CF_PAGES_URL" | "APP_BASE_URL">, request?: Request): string {
  return toOrigin(env.CF_PAGES_URL)
    ?? toOrigin(request?.url)
    ?? toOrigin(env.APP_BASE_URL)
    ?? "http://localhost";
}

export function getConfig(env: Env, request?: Request) {
  return {
    appBaseUrl: resolveAppBaseUrl(env, request),
    minProposalReviews: parseIntOrDefault(env.DEFAULT_MIN_PROPOSAL_REVIEWS, 2),
    referralCodeLength: parseIntOrDefault(env.DEFAULT_REFERRAL_CODE_LENGTH, 7),
    inviteLimitPerAttendee: parseIntOrDefault(env.DEFAULT_INVITE_LIMIT_PER_ATTENDEE, 5),
    waitlistClaimWindowHours: parseIntOrDefault(env.WAITLIST_CLAIM_WINDOW_HOURS, 24),
    magicLinkTtlMinutes: parseIntOrDefault(env.MAGIC_LINK_TTL_MINUTES, 15),
    manageTokenTtlHours: parseIntOrDefault(env.MANAGE_TOKEN_TTL_HOURS, 48),
    sendgridApiBase: env.SENDGRID_API_BASE,
    emailLayoutR2Key: env.EMAIL_LAYOUT_R2_KEY ?? "layouts/email/default.html",
  };
}
