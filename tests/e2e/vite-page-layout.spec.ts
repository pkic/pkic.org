/** @covers presentation.13.5 */
import { expect, test } from "@playwright/test";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { signInToPortal } from "./helpers/portal-auth";

for (const colorScheme of ["light", "dark"] as const) {
  test(`About preserves a compact logo and readable headings in ${colorScheme} mode`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/about/");
      const logo = page.getByRole("img", { name: "Logo of the PKI Consortium" });
      await expect(logo).toBeVisible();
      const dimensions = await logo.boundingBox();
      expect(dimensions!.width).toBeLessThanOrEqual(288);
      expect(dimensions!.width).toBeGreaterThan(150);
      const heading = page.getByRole("heading", { name: "About us", exact: true });
      if (colorScheme === "dark") {
        await expect(heading).toHaveCSS("background-image", "none");
        const color = await heading.evaluate((element) => getComputedStyle(element).color);
        await expect(heading).toHaveCSS("-webkit-text-fill-color", color);
      }
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
      ).toBe(0);
      await page.screenshot({ path: test.info().outputPath(`about-${colorScheme}-${width}.png`), fullPage: true });
    }
  });
}

test("desktop sidebar keeps forms, organizations, and users alongside the workspace", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signInToPortal(page, e2eAdminEmail("portal-appearance"));
  const sidebar = page.locator("#portal-sidebar");
  await expect(sidebar).toBeVisible();
  await expect(page.locator("#portal-sidebar-toggle")).toBeHidden();
  const bounds = await sidebar.boundingBox();
  expect(bounds!.x).toBe(0);
  expect(bounds!.width).toBe(240);
  for (const name of ["Forms", "Organizations", "Users"]) {
    const link = sidebar.getByRole("link", { name, exact: true });
    await link.click();
    await expect(link).toHaveClass(/active/);
    await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
    const main = await page.locator("#portal-main").boundingBox();
    expect(main!.x).toBeGreaterThanOrEqual(bounds!.x + bounds!.width);
    await page.screenshot({ path: test.info().outputPath(`portal-${name.toLowerCase()}.png`), fullPage: true });
  }
});
