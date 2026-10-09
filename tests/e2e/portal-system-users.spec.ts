import { expect, test } from "@playwright/test";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { signInToPortal } from "./helpers/portal-auth";
import { approveMemberThroughReview, uniqueSuffix } from "./helpers/membership";
import { agreeToHeadshotTerms, chooseHeadshotThroughUploadButton } from "./helpers/headshot-upload";

/*
 * Staff putting a photograph on somebody else's record.
 *
 * The member's own upload has been walked for a while; the staff one never
 * was, and it was reported as simply not working. Both run the same controller
 * and the same two dialogs, but through a different manager and a different
 * endpoint, so the coverage of one said nothing about the other.
 */
test("staff upload a photograph onto a user record", async ({ page }) => {
  const suffix = uniqueSuffix();
  const email = `staff-headshot-${suffix}@staff-headshot-${suffix}.test`;

  await signInToPortal(page, e2eAdminEmail("portal-user-headshot"));
  await approveMemberThroughReview(page, {
    email,
    name: `Staff Headshot ${suffix}`,
    organizationName: `Staff Headshot Org ${suffix}`,
  });

  await page.goto("/portal/#/users");
  const search = page.getByPlaceholder("email or name");
  await search.fill(email);
  await search.press("Enter");
  const row = page.locator("tr").filter({ hasText: email });
  await expect(row).toBeVisible();
  await row.click();

  /*
   * The portrait is the control, in the open at the top of the record (#28).
   * It used to be an upload button behind the "Account administration"
   * disclosure, which is what the issue objected to: a photograph is not
   * administration, and nobody looks for their own face under that heading.
   *
   * Through the tile and the picker it opens: reaching past it to the input is
   * what let #28 hide here before. See helpers/headshot-upload.ts.
   */
  await expect(page.getByRole("button", { name: "Account administration", exact: true })).toHaveCount(1);
  await chooseHeadshotThroughUploadButton(page);

  const crop = await agreeToHeadshotTerms(page);
  const uploaded = page.waitForResponse(
    (response) =>
      /\/api\/v1\/users\/[^/]+\/headshot$/.test(new URL(response.url()).pathname) &&
      response.request().method() === "PUT",
  );
  await crop.locator(".crop-headshot-confirm").click();
  expect((await uploaded).status()).toBe(200);

  /*
   * And the portal shows it back, which is the half that was reported as
   * working publicly but not here. Two projections serve the same photograph:
   * the record's own detail builds the staff-only `/headshot` path, the users
   * list builds the public `/headshots/{file}` one — so the assertion accepts
   * either rather than pinning the reader to one of them.
   */
  const portrait = page.locator('img[src*="/headshot"]').first();
  await expect(portrait).toBeVisible({ timeout: 15_000 });
  // Visible is not the same as loaded: a broken image still occupies its box,
  // and a 404 from the image endpoint is exactly the reported symptom.
  await expect
    .poll(async () => portrait.evaluate((img: HTMLImageElement) => img.naturalWidth), { timeout: 15_000 })
    .toBeGreaterThan(0);
  const frame = page.getByRole("button", { name: /^Change photo of / });
  const frameBox = (await frame.boundingBox())!;
  const imageBox = (await portrait.boundingBox())!;
  expect(Math.abs(imageBox.width - imageBox.height), "photo stays square").toBeLessThan(1);
  expect(Math.abs(frameBox.width - imageBox.width), "photo fills its circular frame").toBeLessThanOrEqual(2);
  await expect(portrait).toHaveCSS("object-fit", "cover");
  // #85: the standing must surround only the photo, never editor actions.
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const ring = page.locator(".pk-avatar-standing__ring").filter({ has: frame });
    const ringBox = (await ring.boundingBox())!;
    const pictureBox = (await frame.boundingBox())!;
    expect(Math.abs(ringBox.width - ringBox.height), "standing stays circular").toBeLessThan(1);
    expect(ringBox.width - pictureBox.width, "ring hugs the photo").toBeCloseTo(6, 0);
    await expect(ring.getByRole("button", { name: /^Remove photo of / })).toHaveCount(0);
    await frame.focus();
    await expect(page.getByRole("button", { name: /^Remove photo of / })).toBeVisible();
    const badge = page.locator(".pk-avatar-standing").filter({ has: frame }).locator(".pk-avatar-standing__label");
    expect(
      await badge.evaluate((label) => {
        const box = label.getBoundingClientRect();
        return label.contains(document.elementFromPoint(box.x + box.width / 2, box.y + 2));
      }),
      "badge paints above the photo where they overlap",
    ).toBe(true);
    const removeBox = (await page.getByRole("button", { name: /^Remove photo of / }).boundingBox())!;
    expect(removeBox.y, "remove is at the portrait corner, not a separate row").toBeLessThan(pictureBox.y + 10);
    await page.screenshot({ path: `test-results/issue-85-portrait-${width}.png` });
  }
});
