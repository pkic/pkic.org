import { expect, test } from "@playwright/test";
import { capturedEmailCount, extractEmailUrl, waitForCapturedEmail } from "./helpers/sendgrid";

test("requires a factual organization answer and updates the email path", async ({ page }) => {
  await page.goto("/join/");

  await expect(page.getByRole("heading", { name: "Join the PKI Consortium", exact: true })).toHaveCount(1);
  await expect(page.getByRole("heading", { name: "Membership Application", exact: true })).toHaveCount(1);

  const applicantQuestion = page.locator("legend", {
    hasText: "Are you employed by, or do you own, an organization?",
  });
  await expect(applicantQuestion).toHaveClass(/fs-6/);
  await expect(applicantQuestion).toHaveClass(/fw-semibold/);
  const questionFontSize = await applicantQuestion.evaluate((element) => getComputedStyle(element).fontSize);
  const answerFontSize = await page
    .locator('label[for="joinApplicantOrganization"]')
    .evaluate((element) => getComputedStyle(element).fontSize);
  expect(questionFontSize).toBe(answerFontSize);

  const organizationChoice = page.getByLabel("Yes — I am employed by or own an organization");
  const individualChoice = page.getByLabel("No — I am not employed by and do not own an organization");
  await expect(organizationChoice).toBeVisible();
  await expect(individualChoice).toBeVisible();
  await expect(page.getByLabel("Your official work or organization email address")).toBeHidden();

  await organizationChoice.check();
  const organizationEmail = page.getByLabel("Your official work or organization email address");
  await expect(organizationEmail).toBeVisible();
  await expect(organizationEmail).toHaveAttribute("placeholder", "you@organization.example");
  await expect(page.getByText(/You must participate on behalf of that organization/)).toBeVisible();

  await organizationEmail.fill("person@gmail.com");
  await expect(organizationEmail).toHaveAttribute("aria-invalid", "true");
  await expect(
    page.getByText(/Personal or free email addresses such as Gmail are not accepted for organization participation/),
  ).toBeVisible();

  // Moving away from the field must not let generic email-format validation
  // clear the organization-domain policy error before submission.
  await page.getByRole("button", { name: "Continue" }).focus();
  await expect(organizationEmail).toHaveAttribute("aria-invalid", "true");
  await expect(
    page.getByText(/Personal or free email addresses such as Gmail are not accepted for organization participation/),
  ).toBeVisible();

  await organizationEmail.fill("person@example.test");
  await expect(organizationEmail).not.toHaveAttribute("aria-invalid", "true");

  await individualChoice.check();
  const personalEmail = page.getByLabel("Your personal or university email address");
  await expect(personalEmail).toBeVisible();
  await expect(personalEmail).toHaveValue("");
  await expect(page.getByText(/Individual participation is limited to eligible categories/)).toBeVisible();
  await expect(page.getByText(/H5 — PhD students researching PKI or cryptography/)).toBeVisible();
  await expect(page.getByText(/H6 — Unaffiliated independent PKI or cryptography consultants/)).toBeVisible();
  await expect(page.getByText(/H7 — Unaffiliated independent PKI or cryptography researchers/)).toBeVisible();
  await expect(page.getByText(/A — Certification Authorities and Trust Service Providers/)).toHaveCount(0);
  await expect(page.getByText(/You must participate on behalf of that organization/)).toBeHidden();
});

test("verifies an organization email before submitting the D1-backed membership form", async ({ page }) => {
  const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const email = `membership-${unique}@organization-${unique}.test`;
  const sinceVerification = await capturedEmailCount();

  await page.goto("/join/");
  await page.getByLabel("Yes — I am employed by or own an organization").check();
  await page.getByLabel("Your official work or organization email address").fill(email);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();

  const verification = await waitForCapturedEmail(email, "Verify your email address", {
    since: sinceVerification,
  });
  await page.goto(extractEmailUrl(verification, "#verify="));
  // The real email opens a new document. Playwright otherwise treats this as
  // a same-document hash navigation because the test is already on /join/.
  await page.reload();

  await expect(page.getByRole("heading", { name: "Membership Application", exact: true })).toBeVisible();
  await expect(page.locator("[data-verified-application-email]")).toHaveText(email);
  await expect(page.locator("[data-verified-application-kind]")).toHaveText("Organization application");
  await expect(page.locator("[data-join-application-form] input[type='email']")).toHaveCount(0);
  await expect(page.getByLabel(/H6/)).toHaveCount(0);
  await page.getByLabel(/F —/).check();
  await page.getByLabel("First name").fill("Morgan");
  await page.getByLabel("Last name").fill("Member");
  await page.getByLabel("Organization name").fill(`E2E Organization ${unique}`);
  await page.locator('[name="custom.reason"]').fill("We want to contribute to the PKI community.");

  const legalFields = page.locator("[data-membership-legal-field]");
  await expect(legalFields).toHaveCount(4);
  const firstDocument = page.locator(".membership-legal-card-scroll").first();
  const firstAgreement = firstDocument.locator("[data-membership-legal-input]");
  expect(
    await firstAgreement.evaluate((input) => {
      const container = input.closest<HTMLElement>(".membership-legal-card-scroll");
      return Boolean(container && input.offsetTop > container.clientHeight);
    }),
  ).toBe(true);
  await firstAgreement.scrollIntoViewIfNeeded();
  expect(await firstDocument.evaluate((container) => container.scrollTop)).toBeGreaterThan(0);

  for (const agreement of await page.locator('[data-join-application-form] input[type="checkbox"][required]').all()) {
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
  await page.getByLabel("No — I am not employed by and do not own an organization").check();
  await page.getByLabel("Your personal or university email address").fill(email);
  await page.getByRole("button", { name: "Continue" }).click();

  const verification = await waitForCapturedEmail(email, "Verify your email address", { since });
  await page.goto(extractEmailUrl(verification, "#verify="));
  await page.reload();
  await expect(page.getByRole("heading", { name: "Membership Application", exact: true })).toBeVisible();
  await expect(page.getByLabel(/H5 —/)).toBeVisible();
  await expect(page.getByLabel(/F —/)).toHaveCount(0);
  await expect(page.getByLabel("Organization name")).toBeHidden();
});
