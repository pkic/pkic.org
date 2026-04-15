/**
 * Playwright global setup for E2E tests.
 *
 * All heavy lifting (hugo build, DB seeding, server startup) happens inside
 * scripts/e2e-start.sh which Playwright launches as the webServer.
 * This file only exports the interceptor URL so test specs can reach it.
 */

/** Must match INTERCEPT_PORT in scripts/e2e-start.sh */
const E2E_INTERCEPT_PORT = 48765;

export interface CapturedEmail {
  to: string;
  subject: string;
  payload: Record<string, unknown>;
  capturedAt: string;
}

export default async function globalSetup(): Promise<void> {
  process.env.E2E_SENDGRID_API_BASE = `http://127.0.0.1:${E2E_INTERCEPT_PORT}`;
}
