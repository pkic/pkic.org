import { expect, test } from "@playwright/test";

test("the published directory offers working letter navigation without API reads", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const apiRequests: string[] = [];
  await page.route("**/api/**", async (route) => {
    apiRequests.push(route.request().url());
    await route.abort();
  });
  const response = await page.goto("/members/");
  expect(response?.headers()["x-pkic-publication"]).toContain("static;");
  const cards = page.locator(".member-card");
  await expect(cards.first()).toBeVisible();
  const rail = page.getByRole("navigation", { name: "Jump to letter" });
  const links = rail.getByRole("link");
  expect(await links.count()).toBeGreaterThan(0);
  // Every enabled letter must address a group already present in the HTML.
  for (const link of await links.all()) {
    const href = await link.getAttribute("href");
    expect(href).toMatch(/^#[a-zA-Z0-9-]+$/);
    await expect(page.locator(href!)).toHaveCount(1);
  }
  const last = links.last();
  const destination = page.locator((await last.getAttribute("href"))!);
  await last.focus();
  await page.keyboard.press("Enter");
  await expect(destination.getByRole("heading")).toBeInViewport();
  await expect
    .poll(async () => {
      const target = await destination.getByRole("heading").boundingBox();
      const navbar = await page.getByRole("navigation", { name: "Main", exact: true }).boundingBox();
      return Boolean(target && navbar && target.y >= navbar.y + navbar.height);
    })
    .toBe(true);
  await page.screenshot({ path: test.info().outputPath("directory-letter-desktop.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await destination.locator(".member-card").first().scrollIntoViewIfNeeded();
  await expect(destination.locator(".member-card").first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  expect(apiRequests).toEqual([]);
  await page.screenshot({ path: test.info().outputPath("directory-letter-mobile.png") });
});
