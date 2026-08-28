import { expect, test } from "@playwright/test";
import { capturedEmailCount, extractEmailUrl, waitForCapturedEmail } from "./helpers/sendgrid";

test("verifies an organization email before submitting the D1-backed membership form", async ({ page }) => {
  const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const email = `membership-${unique}@organization-${unique}.test`;
  const sinceVerification = await capturedEmailCount();

  await page.goto("/join/");
  await page.getByLabel("Work or organization email address").fill(email);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();

  const verification = await waitForCapturedEmail(email, "Verify your email address", {
    since: sinceVerification,
  });
  await page.goto(extractEmailUrl(verification, "#verify="));
  // The real email opens a new document. Playwright otherwise treats this as
  // a same-document hash navigation because the test is already on /join/.
  await page.reload();

  await expect(page.getByRole("heading", { name: "Membership application", exact: true })).toBeVisible();
  await expect(page.locator("[data-verified-application-email]")).toHaveText(email);
  await expect(page.getByLabel(/H6/)).toHaveCount(0);
  await page.getByLabel(/F —/).check();
  await page.getByLabel("First name").fill("Morgan");
  await page.getByLabel("Last name").fill("Member");
  await page.getByLabel("Organization name").fill(`E2E Organization ${unique}`);
  await page.locator('[name="custom.reason"]').fill("We want to contribute to the PKI community.");
  for (const agreement of await page.locator('[data-custom-fields] input[type="checkbox"][required]').all()) {
    await agreement.check();
  }

  const sinceConfirmation = await capturedEmailCount();
  const submission = page.waitForResponse(
    (response) => response.url().endsWith("/api/v1/members/applications") && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Submit membership application" }).click();
  expect((await submission).status()).toBe(201);
  await expect(page.getByRole("heading", { name: /Thanks, Morgan Member!/ })).toBeVisible();

  const confirmation = await waitForCapturedEmail(email, "membership application", { since: sinceConfirmation });
  expect(extractEmailUrl(confirmation, "/application-status/")).toContain("token=");
});

test("keeps the individual path an explicit policy exception for an institutional email", async ({ page }) => {
  const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const email = `student-${unique}@university-${unique}.test`;
  const since = await capturedEmailCount();

  await page.goto("/join/");
  await page.getByLabel("Work or organization email address").fill(email);
  await page.getByRole("button", { name: "I am not employed by or representing an organization" }).click();
  await page.getByLabel(/I confirm that I am not employed/).check();
  await page.getByRole("button", { name: "Continue" }).click();

  const verification = await waitForCapturedEmail(email, "Verify your email address", { since });
  await page.goto(extractEmailUrl(verification, "#verify="));
  await page.reload();
  await expect(page.getByRole("heading", { name: "Membership application", exact: true })).toBeVisible();
  await expect(page.getByLabel(/H5 —/)).toBeVisible();
  await expect(page.getByLabel(/F —/)).toHaveCount(0);
  await expect(page.getByLabel("Organization name")).toBeHidden();
});
