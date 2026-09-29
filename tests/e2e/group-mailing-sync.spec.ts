import { expect, test } from "@playwright/test";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { signInToPortal } from "./helpers/portal-auth";

/** @covers groups.8.9 */
test("group managers configure synchronization in one mailing list and request it from its menu", async ({
  page,
}, testInfo) => {
  await signInToPortal(page, e2eAdminEmail("group-mailing-sync"));
  await page.goto("/portal/#/groups/20000000-0000-4000-8000-000000000003/mailing-lists");
  await expect(page.getByRole("region", { name: "Google Groups synchronization", exact: true })).toHaveCount(0);
  const firstRow = page.getByRole("table", { name: "Managed mailing lists" }).getByRole("row").nth(1);
  await firstRow.getByRole("button", { name: /^Actions for / }).focus();
  await page.keyboard.press("Enter");
  await page.screenshot({ path: testInfo.outputPath("mailing-list-sync-menu-desktop.png"), fullPage: true });
  await page.getByRole("menuitem", { name: "Sync now", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: /queued|No subscription changes/ })).toBeVisible();
  await expect(page).toHaveURL(/\/mailing-lists$/);
  await firstRow.click();
  const actions = page.getByRole("button", { name: /^Mailing list actions for / });
  await expect(actions).toBeVisible();
  await page.getByRole("link", { name: "Settings", exact: true }).last().click();
  const panel = page.getByRole("region", { name: "Google Groups synchronization", exact: true });
  const toggle = panel.getByRole("checkbox", { name: /Enable Google Groups synchronization/ });
  await expect(toggle).toBeChecked();
  await expect(panel).toContainText("three-dot actions menu");
  await toggle.uncheck();
  await panel.getByRole("button", { name: "Save synchronization settings", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Synchronization settings saved." })).toHaveText(
    "Synchronization settings saved.",
  );
  await actions.click();
  await expect(page.getByRole("menuitem", { name: "Sync now", exact: true })).toBeDisabled();
  await page.keyboard.press("Escape");
  await page.reload();
  await expect(toggle).not.toBeChecked();
  await toggle.check();
  await panel.getByRole("button", { name: "Save synchronization settings", exact: true }).click();
  await actions.click();
  await page.getByRole("menuitem", { name: "Sync now", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: /queued|No subscription changes/ })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("group-sync-mobile.png"), fullPage: true });
  await page.goto("/portal/#/groups/20000000-0000-4000-8000-000000000003/mailing-lists");
  await firstRow.getByRole("button", { name: /^Actions for / }).click();
  await expect(page.getByRole("menuitem", { name: "Sync now", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("mailing-list-sync-menu-mobile.png"), fullPage: true });
});
