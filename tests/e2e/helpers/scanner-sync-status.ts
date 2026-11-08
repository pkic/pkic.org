import { expect, type Page, type TestInfo } from "@playwright/test";
import { enrolledOfflineEligibilityResponseSchema } from "../../../assets/shared/schemas/event-offline-eligibility";

/** Background badge refreshes retain the roster on failure and never block manual scan uploads. */
export async function checkScannerSyncStatus(page: Page, path: string, info: TestInfo) {
  await page.unroute("**/offline-eligibility?**");
  await page.goto(path);
  const diagnostics = page.getByRole("region", { name: "Recovery and diagnostics" });
  const button = diagnostics.getByRole("button", { name: "Sync now", exact: true });
  await expect(button).toBeEnabled();
  await expect(diagnostics.getByText(/Badge data up to date/)).toBeVisible();
  let release: (() => void) | undefined;
  await page.route("**/offline-eligibility?**", async (route) => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    await route.continue();
  });
  const refreshed = page.waitForResponse((response) =>
    new URL(response.url()).pathname.endsWith("/offline-eligibility"),
  );
  await button.click();
  await expect.poll(() => Boolean(release)).toBe(true);
  await expect(button).toBeEnabled();
  await expect(diagnostics.getByText("Refreshing badge data…", { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({ path: info.outputPath("sync-progress-desktop.png") });
  await page.setViewportSize({ width: 375, height: 844 });
  await page.screenshot({ path: info.outputPath("sync-progress-phone.png") });
  release!();
  const response = await refreshed;
  expect(response.status()).toBe(200);
  const before = enrolledOfflineEligibilityResponseSchema.parse(await response.json());
  await expect(button).toBeEnabled();
  await expect(diagnostics.getByText(/Badge data up to date/)).toBeVisible();
  await page.unroute("**/offline-eligibility?**");
  await page.route("**/offline-eligibility?**", (route) =>
    route.fulfill({ status: 503, contentType: "application/json", body: "{}" }),
  );
  await button.click();
  await expect(diagnostics.getByRole("alert")).toContainText("HTTP 503");
  await expect(diagnostics.getByRole("alert")).toContainText("Using saved badge data");
  await expect(button).toBeEnabled();
  await expect(page.getByRole("dialog", { name: "Continuous badge scanner", exact: true })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath("sync-failure-phone.png") });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({ path: info.outputPath("sync-failure-desktop.png") });
  await page.unroute("**/offline-eligibility?**");
  const recovered = page.waitForResponse((result) => new URL(result.url()).pathname.endsWith("/offline-eligibility"));
  await button.click();
  const restored = enrolledOfflineEligibilityResponseSchema.parse(await (await recovered).json());
  expect(restored.serverNow >= before.serverNow).toBe(true);
  await expect(diagnostics.getByRole("alert")).toHaveCount(0);
  await expect(diagnostics.getByText(/Badge data up to date/)).toBeVisible();
  await expect(diagnostics.getByRole("combobox", { name: "Scan mode", exact: true })).toHaveCount(0);
  await expect(diagnostics.getByRole("button", { name: "Close scanner session", exact: true })).not.toBeVisible();
  await expect(diagnostics.getByRole("heading", { name: "Feedback", exact: true })).toBeVisible();
  const feedback = diagnostics.getByRole("combobox", { name: "Feedback pause", exact: true });
  await feedback.selectOption("5000");
  await page.reload();
  await expect(feedback).toHaveValue("5000");
  await feedback.selectOption("1000");
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: info.outputPath("diagnostics-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 375, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: info.outputPath("diagnostics-phone.png"), fullPage: true });
}
