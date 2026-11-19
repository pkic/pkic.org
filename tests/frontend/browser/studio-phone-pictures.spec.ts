/**
 * The studio on a phone, against the Vite gallery. A graphic that moves by
 * transform or opacity inside a scaled-down picture of an output makes the
 * browser keep graphics layers at the full broadcast size, several per
 * picture: over a gigabyte with the phone studio's four pictures, measured
 * in the Safari engine, so a phone reloads the page. The pictures still move
 * what an operator reads content from, in ways that need no layer.
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

test("pictures of an output move on a phone without a graphics layer", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`${gallery.resolvedUrls!.local[0]}?only=studio-phone-monitors`);
  const studio = page.locator("section#studio-phone-monitors [data-phone]");
  await expect(studio.locator(".pk-live-ticker__track")).not.toHaveCount(0);
  // The ticker travels by its margin and a person's titles take turns by a cut: motion, and none of it layered.
  await expect.poll(async () => (await page.evaluate(moving, PICTURES)).length).toBeGreaterThan(0);
  expect((await page.evaluate(moving, PICTURES)).filter((property) => LAYERED.includes(property))).toEqual([]);
  // The same pictures do move by transform where the phone's rule does not apply, so the check above means something.
  await studio.evaluate((root) => root.removeAttribute("data-phone"));
  await expect
    .poll(async () => (await page.evaluate(moving, PICTURES)).some((property) => LAYERED.includes(property)))
    .toBe(true);
});
