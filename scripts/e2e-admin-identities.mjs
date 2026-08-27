export const E2E_ADMIN_SCOPES = Object.freeze([
  "default",
  "admin-verification",
  "browser-auth",
  "browser-presentation",
  "browser-waitlist",
  "meeting-guest",
  "portal-event",
  "portal-mailing-lists",
  "portal-system-audit",
  "sponsor-portal",
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
