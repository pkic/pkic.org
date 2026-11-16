/** Shared component layout regressions. @covers presentation.13.2 */
import { expect, test } from "@playwright/test";
import { startGallery } from "../../scripts/gallery/server.mjs";

let gallery: Awaited<ReturnType<typeof startGallery>>;

test.beforeAll(async () => {
  gallery = await startGallery({ port: 0 });
});

test.afterAll(async () => {
  await gallery?.close();
});

test("detail lists preserve intrinsic long labels and reflow without overflow", async ({ page }) => {
  await page.goto(`${gallery.resolvedUrls!.local[0]}?only=details`);
  const details = page.locator("section#details");
  await expect(details).toBeVisible();
  await page.evaluate(() => document.fonts.ready);

  for (const width of [1440, 768, 375]) {
    await page.setViewportSize({ width, height: 900 });
    const lists = details.locator("dl");
    for (const list of await lists.all()) {
      expect(await list.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
    }

    if (width > 480) {
      const longLabels = details.locator("dt").filter({ hasText: /^Certification practice statement(?: link)?$/ });
      await expect(longLabels).toHaveCount(3);
      for (const label of await longLabels.all()) {
        expect(
          await label.evaluate((element) => {
            const range = document.createRange();
            range.selectNodeContents(element);
            return range.getClientRects().length;
          }),
        ).toBe(1);
      }
    } else {
      for (const list of await lists.all()) {
        expect(
          await list.evaluate((element) => {
            const term = element.querySelector("dt")!.getBoundingClientRect();
            const value = element.querySelector("dd")!.getBoundingClientRect();
            return value.top >= term.bottom && Math.abs(value.left - term.left) < 1;
          }),
        ).toBe(true);
      }
    }
  }
});
