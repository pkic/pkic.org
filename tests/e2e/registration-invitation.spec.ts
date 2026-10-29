import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { registrationCreateSchema } from "../../assets/shared/schemas/registration";
import { EMAIL_FIRST_COPY } from "../../assets/shared/email-first-copy";
import { continueRegistrationWithEmail } from "./helpers/registration";

const slug = "pqc-conference-amsterdam-nl";
const registrationPath = `/events/2026/${slug}/register/`;

async function captureStep(page: Page, info: TestInfo, step: number, name: string) {
  const panel = page.locator(`[data-step='${step}']`);
  await expect(panel).toBeVisible();
  await expect(panel).toHaveCSS("opacity", "1");
  for (const [width, height, device] of [
    [1280, 900, "desktop"],
    [375, 812, "phone"],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => window.scrollTo(0, 0));
    const form = await page.locator("[data-event-registration] form").boundingBox();
    expect(form).not.toBeNull();
    await page.screenshot({
      path: info.outputPath(`public-registration-${name}-${device}.png`),
      fullPage: true,
      clip: form!,
    });
  }
}

test("checks invitation access before signup and preserves the review on late expiry", async ({ page }, info) => {
  await page.route("**/invites/*/info*", (route) => route.fulfill({ json: { status: "expired" } }));
  await page.goto(`${registrationPath}?invite=expired-invitation-test-token`);
  await expect(page.getByRole("heading", { name: "This invitation has expired" })).toBeVisible();
  await expect(page.getByLabel(EMAIL_FIRST_COPY.registration.work.label)).toBeHidden();
  await page.getByRole("button", { name: "Continue without invitation" }).click();
  await expect(page.getByLabel(EMAIL_FIRST_COPY.registration.work.label)).toBeVisible();
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
  await expect(page.getByLabel(EMAIL_FIRST_COPY.registration.work.label)).toBeVisible();
  await expect(page.getByLabel("First name")).toHaveCount(0);
  await captureStep(page, info, 1, "email");
  await page.screenshot({ path: "test-results/registration-shared-fields.png", fullPage: true });
  await continueRegistrationWithEmail(page, {
    email: "signup-review@example.com",
    firstName: "Signup",
    lastName: "Review",
    organization: "Signup Review Org",
  });
  await captureStep(page, info, 2, "attendance");
  await page.getByRole("button", { name: /^Choose On[- ]demand for every available day$/ }).click();
  await page.getByRole("button", { name: /Continue/ }).click();
  await page.getByLabel("Country").selectOption("US");
  await captureStep(page, info, 3, "questions");
  await page.getByRole("button", { name: /Continue/ }).click();
  const terms = page.locator("[data-term-key] input[required]");
  for (const term of await terms.all()) await term.check();
  const read = page.getByRole("link", { name: /Read:/ }).first();
  await expect(read).toBeVisible();
  await captureStep(page, info, 4, "review");
  await page.screenshot({ path: "test-results/registration-shared-consents.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "test-results/registration-shared-consents-mobile.png", fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.emulateMedia({ colorScheme: "dark" });
  await page.screenshot({ path: "test-results/registration-shared-consents-mobile-dark.png", fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.locator("[data-step='4']").screenshot({ path: "test-results/registration-shared-consents-dark.png" });
  await page.emulateMedia({ colorScheme: "light" });

  let submittedWithoutInvite = false;
  await page.route(`**/api/v1/events/${slug}/registrations`, (route) => {
    const body = registrationCreateSchema.parse(route.request().postDataJSON());
    submittedWithoutInvite = !body.inviteToken;
    return route.fulfill({ status: 400, json: { error: { code: "INVITE_EXPIRED", message: "Invitation expired" } } });
  });
  await page.getByRole("button", { name: "Register", exact: true }).click();
  await expect(page.getByRole("heading", { name: "This invitation has expired" })).toBeVisible();
  await page.getByRole("button", { name: "Continue without invitation" }).click();
  await expect(page.locator("[data-registration-review]")).toContainText("signup-review@example.com");
  await page.getByRole("button", { name: "Register", exact: true }).click();
  await expect.poll(() => submittedWithoutInvite).toBe(true);
});
