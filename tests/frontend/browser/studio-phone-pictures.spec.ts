/**
 * The studio on a phone, against the Vite gallery. A graphic that moves by
 * transform or opacity inside a scaled-down picture of an output makes the
 * browser keep graphics layers at the full broadcast size, several per
 * picture: over a gigabyte with the phone studio's four pictures, measured
 * in the Safari engine, so a phone reloads the page. The thumbnails move only
 * what an operator reads content from, in ways that need no layer; the
 * monitors draw the canvas at half size, so their layers are a quarter of it.
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

const THUMBNAILS = ".pk-studio-phone__thumb-screen";

/** The properties the animations running inside the pictures of an output change now. */
const moving = (pictures: string) => {
  const properties = new Set<string>();
  for (const animation of document.getAnimations()) {
    const effect = animation.effect;
    if (animation.playState !== "running" || !(effect instanceof KeyframeEffect)) continue;
    if (!effect.target?.closest(pictures)) continue;
    for (const frame of effect.getKeyframes())
      for (const property of Object.keys(frame))
        if (!["offset", "easing", "composite", "computedOffset"].includes(property)) properties.add(property);
  }
  return [...properties].sort();
};

/** What makes a browser give a moving graphic a layer of its own. */
const LAYERED = ["transform", "translate", "scale", "rotate", "opacity", "filter"];

test("thumbnails of an output move on a phone without a graphics layer", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`${gallery.resolvedUrls!.local[0]}?only=studio-phone-monitors`);
  const studio = page.locator("section#studio-phone-monitors [data-phone]");
  await expect(studio.locator(".pk-live-ticker__track")).not.toHaveCount(0);
  // The ticker travels by its margin and a person's titles take turns by a cut: motion, and none of it layered.
  await expect.poll(async () => (await page.evaluate(moving, THUMBNAILS)).length).toBeGreaterThan(0);
  expect((await page.evaluate(moving, THUMBNAILS)).filter((property) => LAYERED.includes(property))).toEqual([]);
  // The same pictures do move by transform where the phone's rule does not apply, so the check above means something.
  await studio.evaluate((root) => root.removeAttribute("data-phone"));
  await expect
    .poll(async () => (await page.evaluate(moving, THUMBNAILS)).some((property) => LAYERED.includes(property)))
    .toBe(true);
});

test("a phone's monitors draw the canvas at half size and fit it to the screen", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`${gallery.resolvedUrls!.local[0]}?only=studio-phone-monitors`);
  const screen = page.locator("section#studio-phone-monitors [data-phone] .pk-studio-monitor__screen").first();
  const picture = screen.locator(".pk-live-overlay");
  await expect(picture).toHaveCount(1);
  expect(await picture.evaluate((element) => getComputedStyle(element).zoom)).toBe("0.5");
  const [outer, inner] = await Promise.all([screen.boundingBox(), picture.boundingBox()]);
  expect(Math.round(inner!.width)).toBe(Math.round(outer!.width));
});

test("a monitor out of sight is not drawn until it scrolls into view", async ({ page }) => {
  // A short window: the second monitor of the phone's Monitors view starts well below it.
  await page.setViewportSize({ width: 375, height: 420 });
  await page.goto(`${gallery.resolvedUrls!.local[0]}?only=studio-phone-monitors`);
  const monitors = page.locator("section#studio-phone-monitors [data-phone] .pk-studio-monitor__screen");
  await expect(monitors).toHaveCount(2);
  const last = monitors.last();
  await expect(last.locator(".pk-live-overlay")).toHaveCount(0);
  await last.scrollIntoViewIfNeeded();
  await expect(last.locator(".pk-live-overlay")).toHaveCount(1);
});
