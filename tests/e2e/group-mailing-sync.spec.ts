import { expect, test } from "@playwright/test";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { signInToPortal } from "./helpers/portal-auth";

/** @covers groups.8.9 */
test("group managers pause, resume, and request Google Groups synchronization", async ({ page }, testInfo) => {
  await signInToPortal(page, e2eAdminEmail("group-mailing-sync"));
  await page.goto("/portal/#/groups/20000000-0000-4000-8000-000000000003/mailing-lists");
  const panel = page.getByRole("region", { name: "Google Groups synchronization", exact: true });
  const toggle = panel.getByRole("checkbox", { name: /Enable Google Groups synchronization/ });
  await expect(toggle).toBeChecked();
  await toggle.uncheck();
  await panel.getByRole("button", { name: "Save synchronization settings", exact: true }).click();
  await expect(panel.getByRole("status")).toHaveText("Synchronization settings saved.");
  await expect(panel.getByRole("button", { name: "Sync now", exact: true })).toBeDisabled();
  await page.reload();
  await expect(toggle).not.toBeChecked();
  await toggle.check();
  await panel.getByRole("button", { name: "Save synchronization settings", exact: true }).click();
  await expect(panel.getByRole("button", { name: "Sync now", exact: true })).toBeEnabled();
  await panel.getByRole("button", { name: "Sync now", exact: true }).click();
  await expect(panel.getByRole("status")).toContainText(/queued|No subscription changes/);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("group-sync-mobile.png"), fullPage: true });
});
