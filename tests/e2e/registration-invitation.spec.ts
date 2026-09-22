import { expect, test } from "@playwright/test";
import { registrationCreateSchema } from "../../assets/shared/schemas/registration";

const slug = "pqc-conference-amsterdam-nl";
const registrationPath = `/events/2026/${slug}/register/`;

test("checks invitation access before signup and preserves the review on late expiry", async ({ page }) => {
  await page.route("**/invites/*/info*", (route) => route.fulfill({ json: { status: "expired" } }));
  await page.goto(`${registrationPath}?invite=expired-invitation-test-token`);
  await expect(page.getByRole("heading", { name: "This invitation has expired" })).toBeVisible();
  await expect(page.getByLabel("First name")).toBeHidden();
  await page.getByRole("button", { name: "Continue without invitation" }).click();
  await expect(page.getByLabel("First name")).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`${registrationPath}$`));

  await page.unroute("**/invites/*/info*");
  await page.route("**/invites/*/info*", (route) =>
    route.fulfill({
      json: {
        status: "valid",
        eventName: "Conference",
        inviteeFirstName: "Test",
        inviteType: "attendee",
        registrationUrl: registrationPath,
        proposalUrl: null,
        inviters: [],
        totalInviters: 0,
      },
    }),
  );
  await page.goto(`${registrationPath}?invite=valid-invitation-test-token`);
  await expect(page.getByLabel("First name")).toBeVisible();
  await expect(page.getByRole("button", { name: /Continue/ })).toBeEnabled();
  const firstName = await page.getByLabel("First name").boundingBox();
  const email = await page.getByLabel("Work email").boundingBox();
  expect(firstName!.width / email!.width).toBeGreaterThan(0.45);
  await page.screenshot({ path: "test-results/registration-shared-fields.png", fullPage: true });
  await page.getByLabel("First name").fill("Signup");
  await page.getByLabel("Last name").fill("Review");
  await page.getByLabel("Work email").fill("signup-review@example.com");
  await page.getByRole("button", { name: /Continue/ }).click();
  for (const date of ["2026-12-01", "2026-12-02", "2026-12-03"]) {
    await page.locator(`label[for='dayAttendance-${date}-on_demand']`).click();
  }
  await page.getByRole("button", { name: /Continue/ }).click();
  await page.getByLabel("Organization").fill("Synthetic Test Organization");
  await page.getByLabel("Job title").fill("Engineer");
  await page.getByLabel("Country").selectOption("US");
  await page.getByRole("button", { name: /Continue/ }).click();
  const emailConfirmation = page.getByRole("checkbox", { name: /I checked that/ });
  await emailConfirmation.focus();
  await page.keyboard.press("Space");
  await expect(emailConfirmation).toBeChecked();
  const terms = page.locator("[data-term-key] input[required]");
  for (const term of await terms.all()) await term.check();
  const read = page.getByRole("link", { name: /Read:/ }).first();
  await expect(read).toBeVisible();
  await page.screenshot({ path: "test-results/registration-shared-consents.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "test-results/registration-shared-consents-mobile.png", fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.emulateMedia({ colorScheme: "dark" });
  await page.screenshot({ path: "test-results/registration-shared-consents-mobile-dark.png", fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  const heading = page.getByRole("heading", { name: "Confirm and agree" });
  const headingColor = await heading.evaluate((element) => getComputedStyle(element).color);
  const textColor = await page
    .locator("[data-event-registration]")
    .evaluate((element) => getComputedStyle(element).color);
  expect(headingColor).toBe(textColor);
  await page.locator("[data-step='4']").screenshot({ path: "test-results/registration-shared-consents-dark.png" });
  await page.emulateMedia({ colorScheme: "light" });

  let submittedWithoutInvite = false;
  await page.route(`**/api/v1/events/${slug}/registrations`, (route) => {
    const body = registrationCreateSchema.parse(route.request().postDataJSON());
    submittedWithoutInvite = !body.inviteToken;
    return route.fulfill({ status: 400, json: { error: { code: "INVITE_EXPIRED", message: "Invitation expired" } } });
  });
  await page.getByRole("button", { name: /Submit registration/ }).click();
  await expect(page.getByRole("heading", { name: "This invitation has expired" })).toBeVisible();
  await page.getByRole("button", { name: "Continue without invitation" }).click();
  await expect(emailConfirmation).toBeChecked();
  await expect(page.locator("[data-registration-review-email]")).toHaveText("signup-review@example.com");
  await page.getByRole("button", { name: /Submit registration/ }).click();
  await expect.poll(() => submittedWithoutInvite).toBe(true);
});
