/**
 * @covers join.1.0
 * @covers join.1.0.a
 * @covers join.1.0.b
 */
import { EMAIL_FIRST_ADVISORY_COPY, EMAIL_FIRST_COPY, WORK_EMAIL_STEER } from "../../assets/shared/email-first-copy";
import { openMembershipVerificationLink } from "./helpers/member-join";
import { expect, test, type Locator } from "@playwright/test";
import { capturedEmailCount, extractEmailUrl, waitForCapturedEmail } from "./helpers/sendgrid";

test("starts from the work email and steers a personal address to the explicit individual path", async ({ page }) => {
  await page.goto("/join/");

  await expect(page.getByRole("heading", { name: "Join the PKI Consortium", exact: true })).toHaveCount(1);
  await expect(page.getByRole("heading", { name: "Membership Application", exact: true })).toHaveCount(1);

  await expect(page.getByRole("radio", { name: EMAIL_FIRST_COPY.join.work.title, exact: true })).toBeChecked();
  const organizationEmail = page.getByLabel(EMAIL_FIRST_COPY.join.work.label);
  await expect(organizationEmail).toBeVisible();
  await expect(
    page.getByText(/so we can verify the relationship and keep organizational and IPR attribution/),
  ).toBeVisible();
  await expect(page.locator('input[name="applicantKind"]')).toHaveCount(0);

  await organizationEmail.fill("person@gmail.com");
  // The steer holds the step: nothing is sent for a personal address on behalf of an organization.
  await page.getByRole("button", { name: EMAIL_FIRST_COPY.join.work.action, exact: true }).click();
  await expect(page.getByText(WORK_EMAIL_STEER)).toBeVisible();
  await expect(page.getByText(EMAIL_FIRST_COPY.join.sentTitle, { exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: EMAIL_FIRST_ADVISORY_COPY.usePersonal, exact: true }).click();
  await expect(page.getByRole("radio", { name: EMAIL_FIRST_COPY.join.personal.title, exact: true })).toBeChecked();
  const personalEmail = page.getByLabel(EMAIL_FIRST_COPY.join.personal.label);
  await expect(personalEmail).toHaveValue("person@gmail.com");
  await expect(page.getByText(WORK_EMAIL_STEER)).toHaveCount(0);
  await expect(page.getByText(/H5 — PhD students researching PKI or cryptography/)).toBeVisible();
  await expect(page.getByText(/H6 — Unaffiliated independent PKI or cryptography consultants/)).toBeVisible();
  await expect(page.getByText(/H7 — Unaffiliated independent PKI or cryptography researchers/)).toBeVisible();
  await expect(page.getByText(/A — Certification Authorities and Trust Service Providers/)).toHaveCount(0);

  await page.getByRole("radio", { name: EMAIL_FIRST_COPY.join.work.title, exact: true }).check();
  await expect(page.getByLabel(EMAIL_FIRST_COPY.join.work.label)).toBeVisible();
  await expect(page.getByText(/H5 — PhD students researching PKI or cryptography/)).toBeHidden();
});

test("verifies an organization email before submitting the D1-backed membership form", async ({ page }) => {
  const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const email = `membership-${unique}@organization-${unique}.test`;
  const sinceVerification = await capturedEmailCount();

  await page.goto("/join/");
  await page.getByLabel(EMAIL_FIRST_COPY.join.work.label).fill(email);
  await page.getByRole("button", { name: EMAIL_FIRST_COPY.join.work.action, exact: true }).click();
  await expect(page.getByText(EMAIL_FIRST_COPY.join.sentTitle, { exact: true })).toBeVisible();

  const verification = await waitForCapturedEmail(email, "Verify your email address", {
    since: sinceVerification,
  });
  await openMembershipVerificationLink(page, extractEmailUrl(verification, "#verify="));

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
  const firstLegalCard = legalFields.first();
  const firstDocument = firstLegalCard.locator(".membership-legal-card-scroll");
  const firstAgreement = firstLegalCard.locator("[data-membership-legal-input]");
  await expect(page.getByLabel("How do you expect to participate?", { exact: true })).toHaveValue("active");
  expect(await firstDocument.evaluate((container) => container.scrollHeight > container.clientHeight)).toBe(true);
  expect(await firstAgreement.evaluate((input) => Boolean(input.closest(".membership-legal-card-scroll")))).toBe(true);
  const headerStatus = firstLegalCard.getByRole("status");
  await expect(headerStatus).toHaveText("Agreement required");
  await page.getByRole("button", { name: "Submit membership application", exact: true }).click();
  await expect(headerStatus).toHaveText("Agree to continue");
  await firstLegalCard.scrollIntoViewIfNeeded();
  await expect(headerStatus).toBeInViewport();
  await expect(firstAgreement).not.toBeInViewport();
  // The field's border eases into its state, so compare once it has settled.
  const borderColor = (locator: Locator) => locator.evaluate((element) => getComputedStyle(element).borderTopColor);
  await expect
    .poll(async () => borderColor(page.getByLabel("About yourself", { exact: false })))
    .toBe(await borderColor(firstLegalCard));
  await firstDocument.evaluate((container) => {
    container.scrollTop = container.scrollHeight;
  });
  await expect(firstAgreement).toBeVisible();

  for (const agreement of await page.locator('[data-join-application-form] input[type="checkbox"][required]').all()) {
    await agreement.check();
  }

  await expect(headerStatus).toHaveText("Agreed");
  expect(await firstLegalCard.evaluate((card) => getComputedStyle(card).borderTopColor)).toBe(
    await page.getByLabel("First name").evaluate((input) => getComputedStyle(input).borderTopColor),
  );
  for (const width of [1280, 375]) {
    await page.setViewportSize({ width, height: 900 });
    await firstDocument.evaluate((container) => {
      container.scrollTop = container.scrollHeight;
    });
    const scrollBox = await firstDocument.evaluate((container) => ({
      x: container.getBoundingClientRect().x,
      width: container.clientWidth,
    }));
    const footerBox = await firstLegalCard.locator(".membership-legal-acceptance").boundingBox();
    expect(footerBox!.x).toBeCloseTo(scrollBox.x, 0);
    expect(footerBox!.width).toBeCloseTo(scrollBox.width, 0);
  }
  await page.setViewportSize({ width: 1280, height: 900 });

  const sinceConfirmation = await capturedEmailCount();
  await page.locator('[name="custom.job_title"]').fill("Membership contact");
  await page.getByLabel("About yourself", { exact: false }).fill("I work on PKI interoperability.");
  await page.getByLabel("About your organization", { exact: false }).fill("We build PKI services.");
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
  await page.getByRole("radio", { name: EMAIL_FIRST_COPY.join.personal.title, exact: true }).check();
  await page.getByLabel(EMAIL_FIRST_COPY.join.personal.label).fill(email);
  await page.getByRole("button", { name: EMAIL_FIRST_COPY.join.personal.action, exact: true }).click();

  const verification = await waitForCapturedEmail(email, "Verify your email address", { since });
  await openMembershipVerificationLink(page, extractEmailUrl(verification, "#verify="));
  await expect(page.getByRole("heading", { name: "Membership Application", exact: true })).toBeVisible();
  await expect(page.getByLabel(/H5 —/)).toBeVisible();
  await expect(page.getByLabel(/F —/)).toHaveCount(0);
  await expect(page.getByLabel("Organization name")).toBeHidden();
});
