import type { Page } from "@playwright/test";

/**
 * Run the local Worker's scheduler once and wait for the run to finish. Callers poll the result they wait for.
 *
 * The trigger returns only when the run ends, and a loaded machine can take longer than a request's default 30 seconds.
 * A client that gives up cancels the run mid-flight: it never records its outcome, so its job keeps the lease and every
 * later trigger skips it until the lease expires. The request therefore has no deadline of its own; the caller's poll
 * bounds the wait. A socket the runtime closed while a long run was in flight surfaces as a reset, which the next poll
 * simply retries.
 */
export async function runScheduledWork(page: Page): Promise<void> {
  try {
    await page.request.get("/cdn-cgi/local/scheduled", { timeout: 0 });
  } catch (error) {
    if (!(error instanceof Error) || !/ECONNRESET|socket hang up/u.test(error.message)) throw error;
  }
}
