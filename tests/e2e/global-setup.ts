/**
 * Playwright global setup for E2E tests.
 *
 * All heavy lifting (hugo build, DB seeding, server startup) happens inside
 * scripts/e2e-start.sh which Playwright launches as the webServer.
 * Test specs read the generated interceptor URL from test-results/e2e-sendgrid-url.
 */

export interface CapturedEmail {
  to: string;
  subject: string;
  payload: Record<string, unknown>;
  capturedAt: string;
}

export default async function globalSetup(): Promise<void> {
  process.env.E2E_SENDGRID_URL_FILE = process.env.E2E_SENDGRID_URL_FILE ?? "test-results/e2e-sendgrid-url";
}
