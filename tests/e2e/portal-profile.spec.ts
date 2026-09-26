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
import { expect, test } from "@playwright/test";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { openMyProfile, openProfileEditor, signInToPortal } from "./helpers/portal-auth";
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
  await expect(page.getByRole("heading", { name: `Profile Fields ${suffix}`, level: 2 })).toBeVisible();

  // A record never arrives in edit mode, not even your own (#47): the fields
  // open only once the reader takes "Edit profile" from the record's actions.
  await openProfileEditor(page);

  // Required fields carry a "(required)" suffix in their accessible name
  // (see ui/Field.tsx), so an exact match on the bare label never resolves.
  await page.getByRole("textbox", { name: "First name (required)" }).fill("Renamed First");
  await page.getByRole("textbox", { name: "Last name (required)" }).fill("Renamed Last");
  await page.getByRole("textbox", { name: "Preferred name", exact: true }).fill("Renamed Preferred");
  const saved = page.waitForResponse(
    (response) => response.url().endsWith("/api/v1/users/current") && response.request().method() === "PATCH",
  );
  await page.getByRole("button", { name: "Save changes" }).click();
  expect((await saved).status()).toBe(200);
  await expect(page.locator(".my-toast", { hasText: "Profile updated" })).toBeVisible({ timeout: 15_000 });

  // Reload from a clean mount: the saved values must come back from the
  // server, not merely persist in still-mounted component state. A fresh
  // mount is a record again, so the editor is reopened to read them back.
  await page.reload();
  await openProfileEditor(page);
  await expect(page.getByRole("textbox", { name: "First name (required)" })).toHaveValue("Renamed First");
  await expect(page.getByRole("textbox", { name: "Last name (required)" })).toHaveValue("Renamed Last");
  await expect(page.getByRole("textbox", { name: "Preferred name", exact: true })).toHaveValue("Renamed Preferred");

  // The visibility switch only appears once the identity is organization-tied,
  // which this member is.
  const visibilitySwitch = page.getByRole("switch", {
    name: `Show my name, job title, and bio on ${organizationName}'s public page`,
  });
  await expect(visibilitySwitch).toBeVisible();
  await expect(visibilitySwitch).toBeChecked();

  const hidden = page.waitForResponse(
    (response) => response.url().endsWith("/api/v1/users/current") && response.request().method() === "PATCH",
  );
  await visibilitySwitch.click();
  expect((await hidden).status()).toBe(200);
  await expect(page.locator(".my-toast", { hasText: "hidden from your organization" })).toBeVisible({
    timeout: 15_000,
  });
  await expect(visibilitySwitch).not.toBeChecked();

  const shown = page.waitForResponse(
    (response) => response.url().endsWith("/api/v1/users/current") && response.request().method() === "PATCH",
  );
  await visibilitySwitch.click();
  expect((await shown).status()).toBe(200);
  await expect(page.locator(".my-toast", { hasText: "now appear on your organization" })).toBeVisible({
    timeout: 15_000,
  });
  await expect(visibilitySwitch).toBeChecked();
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
  await expect(page.getByRole("heading", { name: `Profile Headshot ${suffix}`, level: 2 })).toBeVisible();

  /*
   * The portrait itself is the control (#28), and it names what pressing it
   * does: there is no photograph yet, so it offers to upload one. It used to
   * be an "Upload headshot" button under a placeholder reading "You", in a
   * panel further down the record.
   */
  const portrait = page.getByRole("img", { name: `Profile Headshot ${suffix}'s photo` });
  await expect(page.getByRole("button", { name: "Upload photo" })).toBeVisible();
  await expect(portrait).toHaveCount(0);
  // Driven through the tile and the picker it opens, not by reaching past it
  // to the input: see helpers/headshot-upload.ts.
  await chooseHeadshotThroughUploadButton(page);

  const crop = await agreeToHeadshotTerms(page);
  const uploaded = page.waitForResponse(
    (response) => response.url().endsWith("/api/v1/users/current/headshot") && response.request().method() === "PUT",
  );
  await crop.locator(".crop-headshot-confirm").click();
  expect((await uploaded).status()).toBe(200);

  // The "Headshot uploaded" status line is written by the same closure that
  // resolved the upload, but the record's `uploadHeadshot` awaits a full
  // `refreshProfile()` first — which re-renders `AdminHeadshotManager` with a
  // new `initialUrl` and re-runs its wiring effect before that write lands, so
  // the status text is not a reliable signal here. What matters to the reader
  // is the outcome: the real, persisted photo replaces the placeholder.
  await expect(portrait).toBeVisible({ timeout: 15_000 });
  await expect(portrait).toHaveAttribute("src", /\/headshots\//);
  // Visible is not loaded: a broken image still occupies its box, and an
  // empty portrait frame is exactly what #25 and #28 both reported seeing.
  await expect
    .poll(async () => portrait.evaluate((img: HTMLImageElement) => img.naturalWidth), { timeout: 15_000 })
    .toBeGreaterThan(0);
  // The tile now offers the other verb, because there is something to change.
  await expect(page.getByRole("button", { name: "Change photo" })).toBeVisible();

  // The headshot survives a fresh mount, proving it was persisted rather than
  // only reflected in the component the upload happened in.
  await page.reload();
  await expect(portrait).toBeVisible({ timeout: 15_000 });
});

// The other half of the upload flow above: a photo a member put up is theirs
// to take down again. The "Remove headshot" control stays hidden until there
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
  const portrait = page.getByRole("img", { name: `Profile Headshot Remove ${suffix}'s photo` });
  await expect(portrait).toBeVisible({ timeout: 15_000 });

  /*
   * Removing is confirmed in the portal's own dialog rather than the
   * browser's. The portrait tile takes the same route an organization's logo
   * does — `confirmAction`, which the portal mounts — instead of the shared
   * headshot controller's native `confirm()`, which exists only because that
   * controller is also mounted on public token pages with no dialog host.
   */
  const remove = page.waitForResponse(
    (response) => response.url().endsWith("/api/v1/users/current/headshot") && response.request().method() === "DELETE",
  );
  await page.getByRole("button", { name: "Remove photo" }).click();
  await acceptConfirmDialog(page, "Remove photo");
  expect((await remove).status()).toBe(200);
  // Back to the tile offering to upload one, with no picture behind it.
  await expect(page.getByRole("button", { name: "Upload photo" })).toBeVisible({ timeout: 15_000 });
  await expect(portrait).toHaveCount(0);

  await page.reload();
  await expect(page.getByRole("button", { name: "Upload photo" })).toBeVisible({ timeout: 15_000 });
  await expect(portrait).toHaveCount(0);
});
