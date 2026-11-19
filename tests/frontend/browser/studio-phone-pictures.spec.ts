/**
 * The studio on a phone, against the Vite gallery. A running animation inside
 * a scaled-down picture of an output makes the browser keep graphics layers
 * at the full broadcast size, several per picture, and a phone's browser then
 * runs out of memory and reloads the page.
 */
import { expect, test } from "@playwright/test";
import { startGallery } from "../../../scripts/gallery/server.mjs";

let gallery: Awaited<ReturnType<typeof startGallery>>;

test.beforeAll(async () => {
  gallery = await startGallery({ port: 0 });
});

test.afterAll(async () => {
  await gallery?.close();
});

const PICTURES = ".pk-studio-phone__thumb-screen, .pk-studio-monitor__screen";

/** How many animations run inside the pictures of an output now. */
const running = (pictures: string) =>
  document
    .getAnimations()
    .filter((animation) => animation.playState === "running")
    .filter((animation) => {
      const target = animation.effect instanceof KeyframeEffect ? animation.effect.target : null;
      return Boolean(target?.closest(pictures));
    }).length;

test("no picture of an output moves in the phone studio", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`${gallery.resolvedUrls!.local[0]}?only=studio-phone-monitors`);
  const studio = page.locator("section#studio-phone-monitors [data-phone]");
  // The thumbnails and the monitors each draw the ticker, which scrolls on a real output.
  await expect(studio.locator(".pk-live-ticker__track")).not.toHaveCount(0);
  await expect.poll(() => page.evaluate(running, PICTURES)).toBe(0);
  // The same pictures do move where the phone's rule does not apply, so the check above means something.
  await studio.evaluate((root) => root.removeAttribute("data-phone"));
  await expect.poll(() => page.evaluate(running, PICTURES)).toBeGreaterThan(0);
});
