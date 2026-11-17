/**
 * @covers join.1.0
 * @covers join.1.0.a
 * @covers join.1.0.b
 */
import { EMAIL_FIRST_ADVISORY_COPY, EMAIL_FIRST_COPY, WORK_EMAIL_STEER } from "../../assets/shared/email-first-copy";
import { startJoinInBrowser } from "./helpers/member-join";
import { addMissingName, addRepresentationBio } from "./helpers/person-details";
import { expect, test, type Locator } from "@playwright/test";
import { capturedEmailCount, extractEmailUrl, waitForCapturedEmail } from "./helpers/sendgrid";

test("starts from the sign-in card and steers a personal address to the explicit individual path", async ({ page }) => {
  await page.goto("/join/");

  await expect(page.getByRole("heading", { name: "Join the PKI Consortium", exact: true })).toHaveCount(1);
  await expect(page.getByRole("heading", { name: "Membership Application", exact: true })).toHaveCount(1);
  await expect(
    page.getByText(/so we can verify the relationship and keep organizational and IPR attribution/),
  ).toBeVisible();
  await expect(page.locator('input[name="applicantKind"]')).toHaveCount(0);

  // Signed out, the shared sign-in card is the first step; a new person starts with their email.
  const card = page.locator("[data-join-sign-in-card]").getByRole("region", { name: "Sign in", exact: true });
  await card.getByRole("button", { name: "Start your application", exact: true }).click();
  await expect(card.getByRole("radio", { name: EMAIL_FIRST_COPY.join.work.title, exact: true })).toBeChecked();
  const organizationEmail = card.getByLabel(EMAIL_FIRST_COPY.join.work.label);
  await expect(organizationEmail).toBeVisible();

  await organizationEmail.fill("person@gmail.com");
  // The steer holds the step: nothing is sent for a personal address on behalf of an organization.
  await card.getByRole("button", { name: EMAIL_FIRST_COPY.join.work.action, exact: true }).click();
  await expect(card.getByText(WORK_EMAIL_STEER)).toBeVisible();
  await expect(card.getByText(EMAIL_FIRST_COPY.join.sentTitle, { exact: true })).toHaveCount(0);

  await card.getByRole("button", { name: EMAIL_FIRST_ADVISORY_COPY.usePersonal, exact: true }).click();
  await expect(card.getByRole("radio", { name: EMAIL_FIRST_COPY.join.personal.title, exact: true })).toBeChecked();
  await expect(card.getByLabel(EMAIL_FIRST_COPY.join.personal.label)).toHaveValue("person@gmail.com");
  await expect(card.getByText(WORK_EMAIL_STEER)).toHaveCount(0);

  await card.getByRole("radio", { name: EMAIL_FIRST_COPY.join.work.title, exact: true }).check();
  await expect(card.getByLabel(EMAIL_FIRST_COPY.join.work.label)).toBeVisible();
});

test("signs in with an organization email before submitting the D1-backed membership form", async ({
  page,
}, testInfo) => {
  const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const email = `membership-${unique}@organization-${unique}.test`;
  const organizationName = `E2E Organization ${unique}`;

  // The organization is added at account setup, so the page applies as the identity that represents it.
  await startJoinInBrowser(page, email, { organization: { name: organizationName } });

  await expect(page.getByRole("heading", { name: "Membership Application", exact: true })).toBeVisible();
  // The account's proved address and its organization stand for the applicant; neither is typed again.
  const applicant = page.locator("[data-join-signed-in]");
  await expect(applicant).toContainText(email);
  await expect(applicant).toContainText(organizationName);
  await expect(page.locator("[data-join-application-form] input[type='email']")).toHaveCount(0);
  await expect(page.getByLabel("Organization name")).toHaveCount(0);
  await expect(page.getByLabel(/H6/)).toHaveCount(0);
  await expect(page.locator("[data-membership-legal-field]").first().getByRole("status")).toHaveText(
    "Agreement required",
  );
  await addMissingName(page, applicant, { firstName: "Morgan", lastName: "Member" });
  await addRepresentationBio(page, applicant, "I work on PKI interoperability.");
  await page.getByLabel(/F —/).check();
  // Checking the later agreements must not leave focus below earlier unanswered fields.
  await page.getByRole("button", { name: "Submit membership application", exact: true }).click();
  await expect(page.getByLabel("About your organization", { exact: false })).toBeFocused();
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
  await page.getByRole("button", { name: "Submit membership application", exact: true }).click();
  await expect(headerStatus).toHaveText("Agree to continue");
  await firstLegalCard.scrollIntoViewIfNeeded();
  await expect(headerStatus).toBeInViewport();
  await expect(firstAgreement).not.toBeInViewport();
  // The field's border eases into its state, so compare once it has settled.
  const borderColor = (locator: Locator) => locator.evaluate((element) => getComputedStyle(element).borderTopColor);
  await expect
    .poll(async () => borderColor(page.getByLabel("About your organization", { exact: false })))
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
    await page.locator('[name="custom.reason"]').evaluate((input) => getComputedStyle(input).borderTopColor),
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
  await page.getByLabel("About your organization", { exact: false }).fill("We build PKI services.");
  await page.reload();
  await expect(applicant).toContainText(organizationName);
  await expect(page.getByLabel(/F —/)).toBeChecked();
  await expect(page.locator('[name="custom.reason"]')).toHaveValue("We want to contribute to the PKI community.");
  await expect(page.getByLabel("About your organization", { exact: false })).toHaveValue("We build PKI services.");
  await expect(page.getByText(/We restored the answers/)).toBeVisible();
  for (const agreement of await page.locator("[data-membership-legal-input]").all())
    await expect(agreement).not.toBeChecked();
  for (const width of [1280, 375]) {
    await page.setViewportSize({ width, height: 900 });
    await page.locator('[name="custom.reason"]').scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`restored-application-${width}.png`) });
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  for (const agreement of await page.locator('[data-join-application-form] input[type="checkbox"][required]').all())
    await agreement.check();
  // A server refusal must reach the named answer after both validators display errors.
  await page.route(
    "**/api/v1/members/applications",
    async (route) => {
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            code: "VALIDATION_ERROR",
            message: "Review your application.",
            details: { fieldErrors: { "answers.reason": ["Explain your organization's contribution."] } },
          },
        }),
      });
    },
    { times: 1 },
  );
  await page.getByRole("button", { name: "Submit membership application", exact: true }).click();
  await expect(page.locator('[name="custom.reason"]')).toBeFocused();
  await expect(page.getByText("Explain your organization's contribution.", { exact: true })).toBeVisible();
  for (const width of [1280, 375]) {
    await page.setViewportSize({ width, height: 900 });
    await page.locator('[name="custom.reason"]').scrollIntoViewIfNeeded();
    await expect(page.getByText("Explain your organization's contribution.", { exact: true })).toBeInViewport();
    await page.screenshot({ path: testInfo.outputPath(`server-refusal-${width}.png`) });
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.locator('[name="custom.reason"]').fill("We contribute PKI interoperability expertise and testing.");
  const submission = page.waitForResponse(
    (response) => response.url().endsWith("/api/v1/members/applications") && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Submit membership application" }).click();
  expect((await submission).status()).toBe(201);
  await expect(page.getByRole("heading", { name: /Thanks, Morgan Member!/ })).toBeVisible();

  const confirmation = await waitForCapturedEmail(email, "membership application", { since: sinceConfirmation });
  expect(extractEmailUrl(confirmation, "/application-status/")).toContain("token=");
  expect(await page.evaluate(() => sessionStorage.getItem("pkic.join.verifiedApplication"))).toBeNull();
});

test("keeps the individual path an explicit policy exception for an institutional email", async ({ page }) => {
  const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const email = `student-${unique}@university-${unique}.test`;

  await startJoinInBrowser(page, email, { individual: true });
  await expect(page.getByRole("heading", { name: "Membership Application", exact: true })).toBeVisible();
  await expect(page.getByLabel(/H5 —/)).toBeVisible();
  await expect(page.getByLabel(/F —/)).toHaveCount(0);
  await expect(page.getByLabel("Organization name")).toBeHidden();
});

test("says the membership options could not be loaded and keeps the applicant signed in", async ({
  page,
}, testInfo) => {
  const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await page.route("**/api/v1/members/join/verify", (route) =>
    route.fulfill({ status: 503, json: { error: { code: "SERVICE_UNAVAILABLE", message: "Try again" } } }),
  );
  await startJoinInBrowser(page, `outage-${unique}@outage-${unique}.test`);
  const message = page.getByText("We could not load your membership options right now. Refresh to try again.", {
    exact: true,
  });
  await expect(message).toBeVisible();
  await expect(page.locator("[data-join-application-form]")).toBeHidden();
  await expect(page.locator("[data-join-sign-in-card]").getByRole("region", { name: "Sign in" })).toHaveCount(0);
  for (const width of [1280, 375]) {
    await page.setViewportSize({ width, height: 900 });
    await message.scrollIntoViewIfNeeded();
    await expect(message).toBeInViewport();
    await page.screenshot({ path: testInfo.outputPath(`path-failure-${width}.png`) });
  }
});
