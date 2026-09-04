export const E2E_ADMIN_SCOPES = Object.freeze([
  "default",
  "portal-management-verification",
  "browser-auth",
  "browser-presentation",
  "browser-waitlist",
  "meeting-guest",
  "portal-event",
  "portal-event-management",
  "portal-event-attendee-management",
  "portal-event-invitations",
  "portal-event-proposals",
  "portal-access-control",
  "portal-analytics",
  "portal-donations",
  "portal-email-templates",
  "portal-leadership",
  "portal-mailing-lists",
  "portal-organizations",
  // One address per test, not per file. The email limiter allows three
  // requests a minute for an address, so a file whose tests all sign in as
  // `portal-organizations` failed its fourth test on a rule the application
  // is right to enforce. `check-e2e-signin-budget.mjs` keeps it that way.
  "portal-organizations-representatives",
  "portal-organizations-users-view",
  "portal-organizations-profile",
  "portal-organizations-logo",
  "portal-user-record-self",
  "portal-users",
  "portal-system-operations",
  "portal-membership-settings",
  "portal-membership-form",
  "portal-application-stages",
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
  "portal-proposal-states-rejected",
  "portal-colleague-self-service",
  "portal-group-self-service",
  "portal-sign-in-return-path",
  "portal-passkeys",
  "portal-personas-provisioning",
  "portal-persona-interested",
  "portal-persona-voting",
  "portal-persona-reader",
  "portal-system-audit-list",
  "portal-system-audit-states",
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
