/**
 * Driving a headshot upload the way a reader does.
 *
 * `AdminHeadshotManager` renders a visible button and a hidden file input, and
 * the button is what opens the picker. A spec that reaches past the button and
 * calls `setInputFiles` on the input it finds in the DOM proves only that the
 * input has a listener — not that the button reaches it. Issue #28 was exactly
 * that gap: the wiring swapped the input for a clone, leaving the button
 * pointing at an orphan, and both headshot specs kept passing while no reader
 * could upload anything.
 *
 * `waitForEvent("filechooser")` closes the gap: the chooser only opens if the
 * button's click reached a real, attached file input, and the file is handed
 * to whichever input opened it.
 */
import { expect, type Locator, type Page } from "@playwright/test";

/**
 * A one-pixel JPEG, small enough to inline and real enough for the browser's
 * own `Image` decoder and `canvas.drawImage` to accept without complaint.
 */
export const TINY_JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=",
  "base64",
);

/**
 * Presses the portrait and answers the picker it opens.
 *
 * The portrait is the control (#28): a reader changes a photograph by
 * clicking the face at the top of the record, the way every network they
 * already use works — not through an upload button behind a disclosure named
 * "Account administration". The tile names itself for what pressing it does,
 * so it is "Upload photo" until there is one and "Change photo" after.
 */
export async function chooseHeadshotThroughUploadButton(page: Page): Promise<void> {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: /^(Upload|Change) photo$/ }).click();
  await (await chooser).setFiles({ name: "headshot.jpg", mimeType: "image/jpeg", buffer: TINY_JPEG });
}

/**
 * Agrees to the publication terms, and hands back the crop dialog that follows.
 *
 * Both dialogs are mounted from `<template>` elements in
 * `layouts/partials/headshot-modals.html` and opened with `showModal()`, so
 * each is reachable by role — which also proves the roots no longer carry the
 * static `aria-hidden="true"` that once put every control inside them outside
 * the accessibility tree. The `hsd-*`/`crop-headshot-*` classes are the
 * contract between that partial and the scripts that drive it, and are what
 * reaches the individual controls.
 *
 * The crop is confirmed by the caller, because that is the click each spec
 * needs to bracket with the request it expects.
 */
export async function agreeToHeadshotTerms(page: Page): Promise<Locator> {
  const disclaimer = page.getByRole("dialog", { name: "Before uploading a photo" });
  await expect(disclaimer).toBeVisible({ timeout: 10_000 });
  await expect(disclaimer.locator(".hsd-title")).toHaveText("Before uploading a photo");
  await disclaimer.locator(".hsd-agree").check();
  await disclaimer.locator(".hsd-confirm").click();

  const crop = page.getByRole("dialog", { name: "Crop headshot" });
  await expect(crop).toBeVisible({ timeout: 10_000 });
  await expect(crop.locator(".crop-headshot-title")).toHaveText("Crop headshot");
  return crop;
}
