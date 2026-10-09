// One address per test, not per file. The email limiter allows three requests
// a minute for an address, so a file whose tests all sign in as one scope
// eventually fails on a rule the application is right to enforce.
// `check-e2e-signin-budget.mjs` keeps it that way.
export const E2E_ADMIN_SCOPES = Object.freeze([
  "default",
  "scanner-recovery-owner",
  "scanner-recovery-other",
  "portal-agenda-accepted-placement",
  "portal-agenda-preview",
  "portal-agenda-list-readonly",
  "portal-agenda-publication-layout",
  "portal-agenda-staffing-roster",
  "portal-agenda-platform",
  "portal-agenda-public-calendar",
  "portal-agenda-staffing",
  "portal-agenda-track-demand",
  "portal-agenda-transfer-review",
  "portal-agenda-transfer-cli",
  "portal-appearance-overrides",
  "portal-login-layout-expiry",
  "portal-offline-attendance",
  "portal-responsive-widths",
  "portal-responsive-navigation",
  "portal-sponsor-leads",
  "promotion-registration-attribution",
  "portal-session-presentation",
  "portal-management-verification",
  "browser-auth",
  "browser-presentation",
  "browser-historical-mapping-review",
  "browser-historical-mapping-speaker",
  "browser-waitlist",
  "meeting-guest",
  "portal-event",
  "portal-event-management",
  "portal-event-attendee-management",
  "portal-event-proposals",
  "portal-analytics",
  "portal-leadership",
  "portal-group-leadership",
  "public-members-signed-in",
  "portal-organizations",
  "portal-user-create",
  "portal-users-role-management",
  "portal-user-headshot",
  "meeting-participant-links",
  // Never signed in as: a pool identity is a bare `users` row with no
  // membership, which is exactly the starting state a grant needs.
  "portal-join-existing-organization",
  "portal-sponsor-filters",
  "portal-sponsor-tier-pricing",
  "portal-membership-settings",
  "membership-workflows",
  "membership-workflows-categories",
  "membership-workflows-archive",
  "membership-workflows-breadcrumbs",
  "membership-workflows-payment-only",
  "membership-workflows-staff-review-payment",
  "membership-review-access",
  "portal-membership-form",
  "portal-application-stages-approval",
  "portal-application-stages-decline",
  "portal-application-stages-communications",
  "portal-join-categories",
  "portal-member-access",
  "portal-permission-boundaries",
  "portal-identity-security",
  "portal-identity-history",
  "portal-identity-logout",
  "portal-mobile-navigation",
  "portal-dark-theme",
  "portal-appearance",
  "portal-dual-capacity",
  "portal-dual-capacity-guard",
  "portal-vote-participation",
  "portal-vote-replacement",
  "portal-vote-election",
  "portal-vote-window",
  "portal-vote-eligibility",
  "portal-proposal-states",
  "proposal-speaker-identity",
  "portal-colleague-self-service",
  "portal-group-self-service",
  "portal-sign-in-return-path",
  "portal-passkeys",
  "portal-personas-provisioning",
  "portal-persona-interested",
  "portal-persona-voting",
  "portal-persona-reader",
  "sponsor-workspace",
  "votes",
]);

/**
 * How many Playwright worker slots the pool covers.
 *
 * One canonical number: `playwright.config.ts` runs this many workers and the
 * seeder creates identities for exactly that many. It used to size the pool by
 * `cpus().length` while the config ran a single worker, so on a ten-core
 * machine it wrote 580 accounts for a suite that could only ever reach 58 —
 * and that surplus is what pushed the seed past D1's statement ceiling.
 *
 * The suite is serial because the specs share one seeded database and one
 * SendGrid outbox; raising this means proving that isolation first, and then
 * both halves move together because they read the same constant.
 */
export const E2E_WORKER_COUNT = 1;

export function formatE2eAdminEmail(scope, workerIndex) {
  if (!E2E_ADMIN_SCOPES.includes(scope)) {
    throw new Error(`Unknown E2E admin scope: ${scope}`);
  }
  if (!Number.isInteger(workerIndex) || workerIndex < 0) {
    throw new Error(`Invalid E2E worker index: ${workerIndex}`);
  }

  if (scope === "default") {
    return workerIndex === 0 ? "admin@pkic.org" : `admin.w${workerIndex}@pkic.org`;
  }
  return workerIndex === 0 ? `admin.${scope}@pkic.org` : `admin.${scope}.w${workerIndex}@pkic.org`;
}

export function e2eAdminEmailsForWorkerCount(workerCount) {
  if (!Number.isInteger(workerCount) || workerCount < 1) {
    throw new Error(`Invalid E2E worker count: ${workerCount}`);
  }

  return Array.from({ length: workerCount }, (_, workerIndex) =>
    E2E_ADMIN_SCOPES.map((scope) => formatE2eAdminEmail(scope, workerIndex)),
  ).flat();
}
