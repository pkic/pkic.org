/** Browser layout checks against the Vite gallery, without the Worker or database. */
import { expect, test } from "@playwright/test";
import { startGallery } from "../../../scripts/gallery/server.mjs";

let gallery: Awaited<ReturnType<typeof startGallery>>;

test.beforeAll(async () => {
  gallery = await startGallery({ port: 0 });
});

test.afterAll(async () => {
  await gallery?.close();
});

for (const fonts of ["site", "fallback"]) {
  test(`detail lists wrap within their containers with ${fonts} fonts`, async ({ page }) => {
    if (fonts === "fallback") await page.route("**/fonts/**", (route) => route.abort());
    await page.goto(`${gallery.resolvedUrls!.local[0]}?only=details`);
    const details = page.locator("section#details");
    await expect(details).toBeVisible();
    await page.evaluate(() => document.fonts.ready);

    for (const width of [1440, 768, 375]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
      const lists = details.locator("dl");
      await expect(lists).not.toHaveCount(0);
      for (const list of await lists.all()) {
        expect(await list.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
        expect(
          await list.evaluate((element) => {
            const bounds = element.getBoundingClientRect();
            const container = element.parentElement!.getBoundingClientRect();
            return bounds.left >= container.left - 1 && bounds.right <= container.right + 1;
          }),
        ).toBe(true);
      }

      if (width > 480) {
        const longLabels = details.locator("dt").filter({ hasText: /^Certification practice statement(?: link)?$/ });
        await expect(longLabels).toHaveCount(3);
        for (const label of await longLabels.all()) {
          expect(
            await label.evaluate((element) => {
              const text = element.firstChild!;
              const words = [...text.textContent!.matchAll(/\S+/g)];
              return words.every((word) => {
                const range = document.createRange();
                range.setStart(text, word.index);
                range.setEnd(text, word.index + word[0].length);
                return range.getClientRects().length === 1;
              });
            }),
          ).toBe(true);
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
}
