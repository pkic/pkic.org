export const E2E_ADMIN_SCOPES: readonly [
  "default",
  "admin-verification",
  "browser-auth",
  "browser-presentation",
  "browser-waitlist",
  "meeting-guest",
  "portal-event",
  "portal-email-templates",
  "portal-mailing-lists",
  "portal-system-audit",
  "sponsor-portal",
  "votes",
];

export type E2eAdminScope = (typeof E2E_ADMIN_SCOPES)[number];

export function formatE2eAdminEmail(scope: E2eAdminScope, workerIndex: number): string;
export function e2eAdminEmailsForWorkerCount(workerCount: number): string[];
