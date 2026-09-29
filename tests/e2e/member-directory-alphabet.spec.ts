import { expect, test } from "@playwright/test";
import { membersListQuerySchema, publicMembersListResponseSchema } from "../../assets/shared/schemas/members-directory";

test("the directory loads every page before offering letter navigation", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const offsets: number[] = [];
  await page.route("**/api/v1/members?*", async (route) => {
    const query = membersListQuerySchema.parse(Object.fromEntries(new URL(route.request().url()).searchParams));
    offsets.push(query.offset);
    const members = Array.from({ length: query.offset === 0 ? 50 : 1 }, (_, index) => ({
      id: `organization-${query.offset + index}`,
      slug: `organization-${query.offset + index}`,
      name: query.offset === 0 ? `Alpha Organization ${index}` : "Zulu Organization",
      memberType: "organization",
      tier: null,
      memberSince: "2026-01-01T00:00:00.000Z",
      logoUrl: null,
      website: null,
      description: null,
      slogan: null,
    }));
    await route.fulfill({
      json: publicMembersListResponseSchema.parse({
        members,
        page: { limit: query.limit, offset: query.offset, total: 51, hasMore: query.offset === 0 },
      }),
    });
  });
  await page.goto("/members/");
  await expect(page.locator(".member-card")).toHaveCount(51);
  expect(offsets).toEqual([0, 50]);
  const rail = page.getByRole("navigation", { name: "Jump to letter" });
  await expect(rail.getByRole("link", { name: "B", exact: true })).toHaveCount(0);
  const z = rail.getByRole("link", { name: "Z", exact: true });
  await z.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Z", exact: true })).toBeInViewport();
  await expect(page.getByText("Zulu Organization", { exact: true })).toBeVisible();
  const heading = page.getByRole("heading", { name: "Z", exact: true });
  expect((await heading.boundingBox())!.y).toBeGreaterThanOrEqual(100);
  await page.screenshot({ path: test.info().outputPath("directory-z-desktop.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByText("Zulu Organization", { exact: true }).scrollIntoViewIfNeeded();
  await expect(page.getByText("Zulu Organization", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: test.info().outputPath("directory-z-mobile.png") });
});
