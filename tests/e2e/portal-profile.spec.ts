/**
 * A member's own user record — the same page anybody else's record is.
 *
 * `portal-dual-capacity.spec.ts` already exercises the organization-scoped
 * fields (job title, biography, links) while switching between two
 * capacities. What that leaves uncovered is the field every member edits
 * regardless of capacity — first name, last name, preferred name — and the
 * two controls that live beside the form rather than in it: the headshot
 * uploader (crop-and-disclaimer flow, never previously driven end to end by
 * any browser spec) and the organization-page visibility switch.
 * @covers profile.11.1
 * @covers profile.11.2
 * @covers profile.11.3
 */
import sharp from "sharp";
import { expect, test } from "@playwright/test";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { editMyProfile, openMyProfile, signInToPortal } from "./helpers/portal-auth";
import { approveMemberThroughReview, uniqueSuffix } from "./helpers/membership";
import { agreeToHeadshotTerms, chooseHeadshotThroughUploadButton } from "./helpers/headshot-upload";
import { acceptConfirmDialog } from "./helpers/confirm-dialog";

test("a member edits their name fields and toggles organization-page visibility", async ({ page }) => {
  const suffix = uniqueSuffix();
  const email = `profile-fields-${suffix}@profile-fields-${suffix}.test`;
  const organizationName = `Profile Fields Org ${suffix}`;

  await signInToPortal(page, e2eAdminEmail("portal-membership-form"));
  await approveMemberThroughReview(page, { email, name: `Profile Fields ${suffix}`, organizationName });

  await page.context().clearCookies();
  await signInToPortal(page, email);
  await openMyProfile(page);
  // The record opens with the member, not with a page title: `ProfileHeader`
  // names the subject, and the retired "My Profile" page said nothing the
  // sidebar had not.
  await expect(page.getByRole("heading", { name: `Profile Fields ${suffix}`, level: 1 })).toBeVisible();

  // A record never arrives in edit mode, not even your own (#47): the names
  // open in their editor only once the reader takes "Edit profile".
  await editMyProfile(page);

  // Required fields carry a "(required)" suffix in their accessible name
  // (see ui/Field.tsx), so an exact match on the bare label never resolves.
  const editor = page.getByRole("dialog", { name: "Edit names", exact: true });
  await editor.getByRole("textbox", { name: "First name (required)" }).fill("Renamed First");
  await editor.getByRole("textbox", { name: "Last name (required)" }).fill("Renamed Last");
  await editor.getByRole("textbox", { name: "Preferred name", exact: true }).fill("Renamed Preferred");
  const saved = page.waitForResponse(
    (response) => response.url().endsWith("/api/v1/users/current") && response.request().method() === "PATCH",
  );
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  expect((await saved).status()).toBe(200);
  await expect(page.locator(".my-toast", { hasText: "Names updated" })).toBeVisible({ timeout: 15_000 });
  await expect(editor).toBeHidden();

  // Reload from a clean mount: the saved values must come back from the
  // server, not merely persist in still-mounted component state.
  await page.reload();
  await editMyProfile(page);
  const reopened = page.getByRole("dialog", { name: "Edit names", exact: true });
  await expect(reopened.getByRole("textbox", { name: "First name (required)" })).toHaveValue("Renamed First");
  await expect(reopened.getByRole("textbox", { name: "Last name (required)" })).toHaveValue("Renamed Last");
  await expect(reopened.getByRole("textbox", { name: "Preferred name", exact: true })).toHaveValue("Renamed Preferred");
  await reopened.getByRole("button", { name: "Close names editor", exact: true }).click();
  await expect(reopened).toBeHidden();

  // The visibility command is offered on the identity row only once the
  // identity is organization-tied, which this member is.
  const shownOnOrganizationPage = page.getByText("Shown on the organization page", { exact: true });
  await expect(shownOnOrganizationPage).toBeVisible();
  const identityActions = page.getByRole("button", { name: `Actions for ${organizationName}`, exact: true });

  const hidden = page.waitForResponse(
    (response) => response.url().endsWith("/api/v1/users/current") && response.request().method() === "PATCH",
  );
  await identityActions.click();
  await page.getByRole("menuitem", { name: `Hide from ${organizationName}'s public profile`, exact: true }).click();
  expect((await hidden).status()).toBe(200);
  await expect(page.locator(".my-toast", { hasText: "Identity visibility updated" })).toBeVisible({
    timeout: 15_000,
  });
  await expect(shownOnOrganizationPage).toHaveCount(0);

  const shown = page.waitForResponse(
    (response) => response.url().endsWith("/api/v1/users/current") && response.request().method() === "PATCH",
  );
  await identityActions.click();
  await page.getByRole("menuitem", { name: `Show on ${organizationName}'s public profile`, exact: true }).click();
  expect((await shown).status()).toBe(200);
  await expect(shownOnOrganizationPage).toBeVisible();
});

test("a member uploads a headshot through the disclaimer and crop flow", async ({ page }) => {
  const suffix = uniqueSuffix();
  const email = `profile-headshot-${suffix}@profile-headshot-${suffix}.test`;

  await signInToPortal(page, e2eAdminEmail("portal-mobile-navigation"));
  await approveMemberThroughReview(page, {
    email,
    name: `Profile Headshot ${suffix}`,
    organizationName: `Profile Headshot Org ${suffix}`,
  });

  await page.context().clearCookies();
  await signInToPortal(page, email);
  await openMyProfile(page);
  await expect(page.getByRole("heading", { name: `Profile Headshot ${suffix}`, level: 1 })).toBeVisible({
    timeout: 15_000,
  });

  /*
   * The portrait itself is the control (#28), and it names what pressing it
   * does: there is no photograph yet, so it offers to upload one. It used to
   * be an "Upload headshot" button under a placeholder reading "You", in a
   * panel further down the record.
   */
  const portrait = page
    .getByRole("button", { name: new RegExp(`^(Upload|Change) photo of Profile Headshot ${suffix}$`) })
    .locator("img");
  await expect(page.getByRole("button", { name: `Upload photo of Profile Headshot ${suffix}` })).toBeVisible();
  await expect(portrait).toHaveCount(0);
  // Driven through the tile and the picker it opens, not by reaching past it
  // to the input: see helpers/headshot-upload.ts.
  // A non-square, two-color image exposes both missing viewport CSS and incorrect crops.
  const image = await sharp(
    Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="800"><path fill="#e02020" d="M0 0h800v800H0z"/><path fill="#2020e0" d="M800 0h800v800H800z"/></svg>',
    ),
  )
    .jpeg()
    .toBuffer();
  await chooseHeadshotThroughUploadButton(page, image);

  const crop = await agreeToHeadshotTerms(page);
  const viewport = crop.getByRole("group", { name: "Position photo" });
  const beforeZoom = await viewport.boundingBox();
  expect(beforeZoom).not.toBeNull();
  expect(beforeZoom!.width).toBeLessThanOrEqual(300);
  expect(beforeZoom!.height).toBeCloseTo(beforeZoom!.width, 0);
  const zoom = crop.getByRole("slider", { name: "Zoom image" });
  await zoom.press("End");
  expect(await viewport.boundingBox()).toEqual(beforeZoom);
  await zoom.press("Home");
  const box = beforeZoom!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 4, box.y + box.height / 2);
  await page.mouse.up();
  // Finish at the left edge with the keyboard, so the saved square is entirely red.
  await viewport.press("Shift+ArrowRight");
  const uploaded = page.waitForResponse(
    (response) => response.url().endsWith("/api/v1/users/current/headshot") && response.request().method() === "PUT",
  );
  await crop.locator(".crop-headshot-confirm").click();
  expect((await uploaded).status()).toBe(200);

  // What matters to the reader is the outcome: the real, persisted photo
  // replaces the initials in the tile.
  await expect(portrait).toBeVisible({ timeout: 15_000 });
  await expect(portrait).toHaveAttribute("src", /\/headshots\//);
  // Visible is not loaded: a broken image still occupies its box, and an
  // empty portrait frame is exactly what #25 and #28 both reported seeing.
  await expect
    .poll(async () => portrait.evaluate((img: HTMLImageElement) => img.naturalWidth), { timeout: 15_000 })
    .toBeGreaterThan(0);
  const pixels = await portrait.evaluate(async (img: HTMLImageElement) => {
    const response = await fetch(img.src);
    const bitmap = await createImageBitmap(await response.blob());
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1024;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(bitmap, 0, 0);
    return [
      [10, 10],
      [512, 512],
      [1010, 1010],
    ].map(([x, y]) => [...ctx.getImageData(x, y, 1, 1).data]);
  });
  for (const [red, green, blue] of pixels) {
    expect(red).toBeGreaterThan(190);
    expect(green).toBeLessThan(60);
    expect(blue).toBeLessThan(60);
  }
  // The tile now offers the other verb, because there is something to change.
  await expect(page.getByRole("button", { name: `Change photo of Profile Headshot ${suffix}` })).toBeVisible();

  // The headshot survives a fresh mount, proving it was persisted rather than
  // only reflected in the component the upload happened in.
  await page.reload();
  await expect(portrait).toBeVisible({ timeout: 15_000 });
});

// The other half of the upload flow above: a photo a member put up is theirs
// to take down again. The "Remove photo" control stays hidden until there
// is something to remove, so this uploads first and then removes, and checks
// the placeholder survives a fresh mount — proving the removal reached the
// server rather than only the component it was clicked in.
test("a member can remove their own headshot", async ({ page }) => {
  const suffix = uniqueSuffix();
  const email = `profile-headshot-remove-${suffix}@profile-headshot-remove-${suffix}.test`;

  await signInToPortal(page, e2eAdminEmail("portal-dark-theme"));
  await approveMemberThroughReview(page, {
    email,
    name: `Profile Headshot Remove ${suffix}`,
    organizationName: `Profile Headshot Remove Org ${suffix}`,
  });

  await page.context().clearCookies();
  await signInToPortal(page, email);
  await openMyProfile(page);
  await chooseHeadshotThroughUploadButton(page);
  await (await agreeToHeadshotTerms(page)).locator(".crop-headshot-confirm").click();
  const portrait = page
    .getByRole("button", { name: `Change photo of Profile Headshot Remove ${suffix}` })
    .locator("img");
  await expect(portrait).toBeVisible({ timeout: 15_000 });

  /*
   * Removing is confirmed in the portal's own dialog rather than the
   * browser's. The portrait tile takes the same route an organization's logo
   * does — `confirmAction`, which every page carrying the tile mounts — rather
   * than the browser's native `confirm()`.
   */
  const remove = page.waitForResponse(
    (response) => response.url().endsWith("/api/v1/users/current/headshot") && response.request().method() === "DELETE",
  );
  await page.getByRole("button", { name: `Remove photo of Profile Headshot Remove ${suffix}` }).click();
  await acceptConfirmDialog(page, "Remove photo");
  expect((await remove).status()).toBe(200);
  // Back to the tile offering to upload one, with no picture behind it.
  await expect(page.getByRole("button", { name: `Upload photo of Profile Headshot Remove ${suffix}` })).toBeVisible({
    timeout: 15_000,
  });
  await expect(portrait).toHaveCount(0);

  await page.reload();
  await expect(page.getByRole("button", { name: `Upload photo of Profile Headshot Remove ${suffix}` })).toBeVisible({
    timeout: 15_000,
  });
  await expect(portrait).toHaveCount(0);
});
