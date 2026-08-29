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
  "portal-users",
  "portal-system-operations",
  "portal-membership-settings",
  "portal-membership-form",
  "portal-system-audit-list",
  "portal-system-audit-states",
  "sponsor-workspace",
  "votes",
]);

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
