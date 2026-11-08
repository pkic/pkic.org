import { expect, webkit, type Page, type TestInfo } from "@playwright/test";
import { openScannerManualEntry, scannerStorage } from "./scanner-recovery-storage";

/** Fresh WebKit preparation and offline capture after manual entry has loaded online. */
export async function checkWebKitOfflineScanner(source: Page, path: string, credential: string, info: TestInfo) {
  const browser = await webkit.launch();
  try {
    const context = await browser.newContext({
      baseURL: new URL(source.url()).origin,
      storageState: { cookies: await source.context().cookies(), origins: [] },
      viewport: { width: 375, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    const page = await context.newPage();
    await page.goto(path);
    await expect(page.getByText(/Offline scanner prepared until/)).toBeVisible({ timeout: 45000 });
    await expect(page.getByRole("combobox", { name: "Feedback pause", exact: true })).toHaveValue("1000");
    await page.screenshot({ path: info.outputPath("webkit-offline-ready-phone.png"), fullPage: true });
    // WebKit's automation offline switch also prevents cached worker navigation.
    // Open manual entry online first: this does not cover opening it offline or an offline reload.
    // Chromium's preceding journey covers those steps; WebKit verifies the subsequent local capture.
    await openScannerManualEntry(page);
    await context.setOffline(true);
    await page.getByRole("textbox", { name: /^Badge code(?: or attendee)?$/ }).fill(credential);
    await page.getByRole("button", { name: "Record attendance", exact: true }).click();
    await expect.poll(async () => (await scannerStorage(page)).pending.length).toBe(1);
    expect((await scannerStorage(page)).pending[0]!.scan.badgeId).toBe(credential);
    await expect(page.locator(".pk-fast-scanner__label")).toContainText("Registered");
    await page.screenshot({ path: info.outputPath("webkit-offline-scanned-phone.png") });
  } finally {
    await browser.close();
  }
}
