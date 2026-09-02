/**
 * Account Settings — the identity's own notification preferences and access
 * summary. Sign-out is covered in `portal-identity-security.spec.ts`, identity
 * acceptance in `member-colleague-self-service.spec.ts`, and passkeys get
 * their own end-to-end coverage in `browser-auth.spec.ts`. What is left is the
 * page's own two cards: the four notification toggles, and the access summary
 * that tells a member which capacities and permissions their session actually
 * carries.
 */
import { expect, test } from "@playwright/test";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { signInToPortal } from "./helpers/portal-auth";
import { approveMemberThroughReview, uniqueSuffix } from "./helpers/membership";

test("a member toggles every notification preference and it persists across reload", async ({ page }) => {
  const suffix = uniqueSuffix();
  const email = `account-notifications-${suffix}@account-notifications-${suffix}.test`;
  const organizationName = `Account Notifications Org ${suffix}`;

  await signInToPortal(page, e2eAdminEmail("portal-permission-boundaries"));
  await approveMemberThroughReview(page, { email, name: `Account Notifications ${suffix}`, organizationName });

  await page.context().clearCookies();
  await signInToPortal(page, email);
  await page.goto("/portal/#/account");
  await expect(page.getByRole("heading", { name: "Account Settings" })).toBeVisible();

  const preferences = [
    "Working group updates",
    "Vote reminders",
    "General consortium announcements",
    "Working group roster change digest (chairs & vice-chairs only, weekly)",
  ] as const;

  // Every preference starts checked (the schema's default), so this exercises
  // the same PATCH round trip four times, once per named preference.
  for (const label of preferences) {
    const toggle = page.getByRole("switch", { name: label });
    await expect(toggle).toBeVisible();
    await expect(toggle).toBeChecked();
    const patched = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/v1/users/current/notifications/preferences") &&
        response.request().method() === "PATCH",
    );
    await toggle.click();
    expect((await patched).status(), `toggling "${label}"`).toBe(200);
    await expect(toggle).not.toBeChecked();
  }

  // Reload from a clean mount: every preference must come back off from the
  // server, not merely reflect still-mounted component state.
  await page.reload();
  for (const label of preferences) {
    await expect(page.getByRole("switch", { name: label })).not.toBeChecked();
  }

  // Flip one back on to prove the toggle is not one-directional.
  const first = page.getByRole("switch", { name: preferences[0] });
  const restored = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/v1/users/current/notifications/preferences") &&
      response.request().method() === "PATCH",
  );
  await first.click();
  expect((await restored).status()).toBe(200);
  await expect(first).toBeChecked();
});

test("the access summary names a member's organization and category", async ({ page }) => {
  const suffix = uniqueSuffix();
  const email = `account-access-${suffix}@account-access-${suffix}.test`;
  const organizationName = `Account Access Org ${suffix}`;

  await signInToPortal(page, e2eAdminEmail("portal-sign-in-return-path"));
  await approveMemberThroughReview(page, {
    email,
    name: `Account Access ${suffix}`,
    organizationName,
    category: "F",
  });

  await page.context().clearCookies();
  await signInToPortal(page, email);
  await page.goto("/portal/#/account");
  await expect(page.getByRole("heading", { name: "Account Settings" })).toBeVisible();

  await expect(page.getByText(email, { exact: true })).toBeVisible();
  // Panel renders a bare <section> with no accessible name of its own (see
  // ui/Panel.tsx) — AccountSettings never adds the aria-label some other
  // surfaces do, so the panel is found through its own heading rather than
  // through a "region" role that the markup does not expose.
  const accessPanel = page.locator("section").filter({ has: page.getByRole("heading", { name: "Your access" }) });
  await expect(accessPanel).toBeVisible();
  await expect(accessPanel.getByRole("link", { name: organizationName })).toBeVisible();
  await expect(accessPanel.getByText("PKI or cryptographic software and device providers (F)")).toBeVisible();

  // Every session carries a baseline `staff` capacity (role "user", no
  // grants and no scopes) even for an identity with no administrative access
  // at all, so the panel's "Permissions" heading always renders — it is the
  // explicit "none granted" copy, not the heading's presence, that tells a
  // plain member they hold nothing extra.
  await expect(accessPanel.getByText("Permissions", { exact: true })).toBeVisible();
  await expect(accessPanel.getByText("No individual permissions are granted to this account.")).toBeVisible();
  await expect(accessPanel.locator("code")).toHaveCount(0);

  // This identity sponsors nothing, so that heading is genuinely absent.
  await expect(accessPanel.getByText("Sponsor access", { exact: true })).toHaveCount(0);
});
