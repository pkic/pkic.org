/**
 * Derives a per-scenario and per-Playwright-worker admin identity for E2E
 * specs that exercise the real magic-link flow. Scenarios must not share an
 * address: serial CI otherwise funnels every spec through worker 0 and trips
 * EMAIL_RATE_LIMITER even though the application behavior is correct.
 */
import { formatE2eAdminEmail, type E2eAdminScope } from "../../scripts/e2e-admin-identities.mjs";

export function e2eAdminEmail(scope: E2eAdminScope = "default"): string {
  const workerIndex = Number.parseInt(process.env.TEST_PARALLEL_INDEX ?? "0", 10);
  return formatE2eAdminEmail(scope, workerIndex);
}
