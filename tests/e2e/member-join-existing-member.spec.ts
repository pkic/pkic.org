/** Returning members should reach sign-in, not another application. @covers join.1.0 */
import { expect, test } from "@playwright/test";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { approveMemberThroughReview, uniqueSuffix } from "./helpers/membership";
import { signInToPortal } from "./helpers/portal-auth";
import { openMembershipVerificationLink } from "./helpers/member-join";
import { capturedEmailCount, extractEmailUrl, waitForCapturedEmail } from "./helpers/sendgrid";

test("existing members get sign-in instructions and old join links remain helpful", async ({ page }) => {
  const suffix = uniqueSuffix();
  const email = `returning-${suffix}@returning-${suffix}.test`;
  const requestJoin = async () => {
    await page.goto("/join/");
    await page.getByLabel("Yes — I am employed by or own an organization").check();
    await page.getByLabel("Your official work or organization email address").fill(email);
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
  };
  const beforeVerification = await capturedEmailCount();
  await requestJoin();
  const verification = await waitForCapturedEmail(email, "Verify your email address", { since: beforeVerification });
  const oldLink = extractEmailUrl(verification, "/join/");

  await signInToPortal(page, e2eAdminEmail("portal-vote-election"));
  await approveMemberThroughReview(page, {
    email,
    name: `Returning Member ${suffix}`,
    organizationName: `Returning Organization ${suffix}`,
  });
  await page.context().clearCookies();
  await openMembershipVerificationLink(page, oldLink);
  await expect(page.getByRole("heading", { name: "You already have member access" })).toBeVisible();
  await expect(page.locator("[data-join-application-form]")).toBeHidden();
  await page
    .locator("[data-join-already-member]")
    .screenshot({ path: test.info().outputPath("returning-member-guidance.png") });
  await page.getByRole("link", { name: "Sign in to the member portal" }).click();
  await expect(page.getByRole("button", { name: "Sign in with a passkey" })).toBeVisible();

  const sinceGuidance = await capturedEmailCount();
  await requestJoin();
  const guidance = await waitForCapturedEmail(email, "You already have PKI Consortium member access", {
    since: sinceGuidance,
  });
  const rendered = JSON.stringify(guidance.payload);
  expect(rendered).toContain("You do not need to submit another membership application");
  expect(rendered).toContain("Enter the same email address");
  expect(rendered).not.toContain("#verify=");
  const loginUrl = extractEmailUrl(guidance, "/portal/");
  await page.goto(loginUrl);
  await expect(page.getByRole("button", { name: "Sign in with a passkey" })).toBeVisible();
  await signInToPortal(page, email);
  await expect(page.getByRole("button", { name: "Account menu" })).toBeVisible();
});
