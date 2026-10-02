/** @covers presentation.13.7 */
import { expect, test } from "@playwright/test";

test("public search accepts focus and closes with Escape", async ({ page }) => {
  await page.goto("/wg/cm/");
  await page.getByRole("button", { name: "Open search", exact: true }).filter({ visible: true }).click();
  await expect(page.getByRole("searchbox", { name: "Search", exact: true }).filter({ visible: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.locator("#pkicSearchPanel")).toBeHidden();
});

test("mobile navigation opens and closes with Escape", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  const toggle = page.getByRole("button", { name: "Toggle navigation" });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Escape");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
});
