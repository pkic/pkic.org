/**
 * My Profile — the identity's own editable record.
 *
 * `portal-dual-capacity.spec.ts` already exercises the organization-scoped
 * fields (job title, biography, links) while switching between two
 * capacities. What that leaves uncovered is the field every member edits
 * regardless of capacity — first name, last name, preferred name — and the
 * two controls that live beside the form rather than in it: the headshot
 * uploader (crop-and-disclaimer flow, never previously driven end to end by
 * any browser spec) and the organization-page visibility switch.
 */
import { expect, test } from "@playwright/test";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { signInToPortal } from "./helpers/portal-auth";
import { approveMemberThroughReview, uniqueSuffix } from "./helpers/membership";

// A one-pixel JPEG, small enough to inline and real enough for the browser's
// own `Image` decoder and `canvas.drawImage` to accept without complaint.
const TINY_JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=",
  "base64",
);

test("a member edits their name fields and toggles organization-page visibility", async ({ page }) => {
  const suffix = uniqueSuffix();
  const email = `profile-fields-${suffix}@profile-fields-${suffix}.test`;
  const organizationName = `Profile Fields Org ${suffix}`;

  await signInToPortal(page, e2eAdminEmail("portal-membership-form"));
  await approveMemberThroughReview(page, { email, name: `Profile Fields ${suffix}`, organizationName });

  await page.context().clearCookies();
  await signInToPortal(page, email);
  await page.goto("/portal/#/profile");
  // The record opens with the member, not with a page title: `ProfileHeader`
  // names the subject, and "My Profile" said nothing the sidebar had not.
  await expect(page.getByRole("heading", { name: `Profile Fields ${suffix}`, level: 2 })).toBeVisible();

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
  // server, not merely persist in still-mounted component state.
  await page.reload();
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
  await page.goto("/portal/#/profile");
  await expect(page.getByRole("heading", { name: `Profile Headshot ${suffix}`, level: 2 })).toBeVisible();

  // MyProfile overrides the placeholder's default copy with `emptyLabel="You"`.
  await expect(page.getByText("You", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Upload headshot" }).click();
  await page.locator('input[type="file"][accept="image/jpeg,image/png,image/webp"]').setInputFiles({
    name: "headshot.jpg",
    mimeType: "image/jpeg",
    buffer: TINY_JPEG,
  });

  // Both mounted-from-<template> dialogs (layouts/partials/headshot-modals.html)
  // are native <dialog> elements opened with showModal(), so each is reachable
  // by role — which is what `getByRole("dialog")` below asserts, since the
  // roots used to carry a static `aria-hidden="true"` that put every control
  // inside them outside the accessibility tree. The `hsd-*`/`crop-headshot-*`
  // classes are the contract between the partial and the scripts that drive
  // it, and are what this spec uses to reach the individual controls.
  const disclaimer = page.getByRole("dialog", { name: "Before uploading a photo" });
  await expect(disclaimer).toBeVisible({ timeout: 10_000 });
  // AdminHeadshotManager overrides the default disclaimer title with its own.
  await expect(disclaimer.locator(".hsd-title")).toHaveText("Before uploading a photo");
  await disclaimer.locator(".hsd-agree").check();
  await disclaimer.locator(".hsd-confirm").click();

  const crop = page.getByRole("dialog", { name: "Crop headshot" });
  await expect(crop).toBeVisible({ timeout: 10_000 });
  await expect(crop.locator(".crop-headshot-title")).toHaveText("Crop headshot");
  const uploaded = page.waitForResponse(
    (response) => response.url().endsWith("/api/v1/users/current/headshot") && response.request().method() === "PUT",
  );
  await crop.locator(".crop-headshot-confirm").click();
  expect((await uploaded).status()).toBe(200);

  // The "Headshot uploaded" status line is written by the same closure that
  // resolved the upload, but MyProfile's `uploadHeadshot` awaits a full
  // `refreshProfile()` first — which re-renders `AdminHeadshotManager` with a
  // new `initialUrl` and re-runs its wiring effect before that write lands, so
  // the status text is not a reliable signal here. What matters to the reader
  // is the outcome: the real, persisted photo replaces the placeholder.
  await expect(page.getByRole("img", { name: email })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("img", { name: email })).toHaveAttribute("src", /\/headshots\//);

  // The headshot survives a fresh mount, proving it was persisted rather than
  // only reflected in the component the upload happened in.
  await page.reload();
  await expect(page.getByRole("img", { name: email })).toBeVisible({ timeout: 15_000 });
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
  await page.goto("/portal/#/profile");
  await page.getByRole("button", { name: "Upload headshot" }).click();
  await page.locator('input[type="file"][accept="image/jpeg,image/png,image/webp"]').setInputFiles({
    name: "headshot.jpg",
    mimeType: "image/jpeg",
    buffer: TINY_JPEG,
  });
  // See the note on the disclaimer/crop dialogs above.
  const disclaimer = page.getByRole("dialog", { name: "Before uploading a photo" });
  await disclaimer.locator(".hsd-agree").check();
  await disclaimer.locator(".hsd-confirm").click();
  await page.locator("#crop-headshot-modal .crop-headshot-confirm").click();
  await expect(page.getByRole("img", { name: email })).toBeVisible({ timeout: 15_000 });

  // The shared headshot controller still confirms through the native dialog
  // (see its TODO(confirm-dialog) note: it is also mounted on public token
  // pages that never render <ConfirmDialogHost/>), and Playwright dismisses
  // dialogs unless something accepts them.
  page.on("dialog", (dialog) => void dialog.accept());

  const remove = page.waitForResponse(
    (response) => response.url().endsWith("/api/v1/users/current/headshot") && response.request().method() === "DELETE",
  );
  await page.getByRole("button", { name: "Remove headshot" }).click();
  expect((await remove).status()).toBe(200);
  // MyProfile overrides the placeholder's default copy with `emptyLabel="You"`.
  await expect(page.getByText("You", { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("img", { name: email })).toHaveCount(0);

  await page.reload();
  await expect(page.getByText("You", { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("img", { name: email })).toHaveCount(0);
});
