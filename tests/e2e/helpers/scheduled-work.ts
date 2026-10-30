import type { Page } from "@playwright/test";

/**
 * Nudge the local Worker's scheduler. The call only starts work; callers poll the result they wait for. A socket the
 * runtime closed while a long scheduled run was in flight surfaces as a reset, which the next poll simply retries.
 */
export async function runScheduledWork(page: Page): Promise<void> {
  await page.request.get("/cdn-cgi/local/scheduled").catch(() => undefined);
}
