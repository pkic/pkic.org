/** Browser layout checks against the Vite gallery, without the Worker or database. */
import { expect, test } from "@playwright/test";
import { formSubmissionsExportQuerySchema } from "../../../assets/shared/schemas/form-management";
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

    for (const width of [1440, 768, 375]) {
      await page.setViewportSize({ width, height: 900 });
      await details.evaluate(async (section, loadSiteFonts) => {
        if (loadSiteFonts) {
          await Promise.all(
            [...section.querySelectorAll("dt, dd")].map((element) => {
              const style = getComputedStyle(element);
              return document.fonts.load(
                `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`,
                element.textContent ?? "",
              );
            }),
          );
        }
        await document.fonts.ready;
      }, fonts === "site");
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
      const lists = details.locator("dl");
      await expect(lists).not.toHaveCount(0);
      for (const list of await lists.all()) {
        expect(await list.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
        expect(
          await list.evaluate((element) => {
            const bounds = element.getBoundingClientRect();
            const container = element.closest(".pk-panel__body, td")!.getBoundingClientRect();
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
          const terms = list.locator("dt");
          await expect(terms).not.toHaveCount(0);
          for (const term of await terms.all()) {
            expect(
              await term.evaluate((element) => {
                const value = element.nextElementSibling;
                if (value?.tagName !== "DD") return false;
                const termBounds = element.getBoundingClientRect();
                const valueBounds = value.getBoundingClientRect();
                return valueBounds.top >= termBounds.bottom && Math.abs(valueBounds.left - termBounds.left) < 1;
              }),
            ).toBe(true);
          }
        }
      }
    }
  });
}

test("response answer filters, keyboard sorting, and venue CSV links work at desktop and phone widths", async ({
  page,
}, testInfo) => {
  // Avoid Chromium revalidating the gallery's large development module graph on reload.
  await page.route("**/*", (route) => route.continue());
  await page.goto(`${gallery.resolvedUrls!.local[0]}?only=form-responses`);
  const responses = page.locator("section#form-responses");
  await expect(responses.getByText("Ada Example", { exact: true })).toBeVisible();
  await responses.getByLabel("Filter answer field", { exact: true }).selectOption("dietary_restrictions");
  await responses.getByLabel("Filter Dietary restrictions", { exact: true }).selectOption("vegan");
  const download = responses.getByRole("link", { name: "Download Dietary restrictions (CSV)", exact: true });
  await expect(download).toBeVisible();
  const href = await download.getAttribute("href");
  const query = formSubmissionsExportQuerySchema.parse(Object.fromEntries(new URL(href!, page.url()).searchParams));
  expect(query).toMatchObject({
    answerField: "dietary_restrictions",
    answerValue: "vegan",
    field: "dietary_restrictions",
  });
  const options = responses.getByRole("button", { name: "Dietary restrictions column options", exact: true });
  await options.focus();
  await options.press("Enter");
  const ascending = page.getByRole("menuitemradio", { name: "Sort ascending", exact: true });
  await ascending.focus();
  await ascending.press("Enter");
  await expect(page).toHaveURL(/form-responses.sort=answer%3Adietary_restrictions/);
  await expect(options).toBeFocused();
  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(download).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: testInfo.outputPath(`form-responses-${width}.png`) });
  }
  await page.reload();
  await expect(responses.getByLabel("Filter Dietary restrictions", { exact: true })).toHaveValue("vegan");
});
