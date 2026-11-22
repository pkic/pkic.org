import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { registrationCreateSchema } from "../../assets/shared/schemas/registration";
import { continueRegistrationWithEmail, ownDomainEmail, registerInBrowser } from "./helpers/registration";
import { acceptConfirmDialog } from "./helpers/confirm-dialog";

const slug = "pqc-conference-amsterdam-nl";
const registrationPath = `/events/2026/${slug}/register/`;

test("cancelled attendees can restore registration without stale badge or invitation actions", async ({
  page,
}, info) => {
  const email = ownDomainEmail("cancel-restore");
  const submitted = await registerInBrowser(page, email, undefined, undefined, {
    // An organization name belongs to the domain that first claimed it, so each run names its own.
    organization: `Synthetic Attendee Services ${Date.now()}`,
    attendanceLabel: "In-person",
  });
  await expect(page.getByRole("heading", { name: /You're registered/ })).toBeVisible();
  const { manageUrl, manageToken } = await submitted.manageLink();
  await page.goto(manageUrl);
  await page.getByRole("button", { name: "Cancel my registration…", exact: true }).click();
  await acceptConfirmDialog(page, "Cancel registration");
  await expect(page.getByRole("heading", { name: "Registration cancelled", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Download badge (PNG)", exact: true })).toBeHidden();
  await page.reload();
  await expect(page.getByText("This registration is cancelled", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "My agenda", exact: true })).toBeHidden();
  for (const [width, height, device] of [
    [1280, 900, "desktop"],
    [375, 812, "phone"],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.screenshot({ path: info.outputPath(`cancelled-registration-${device}.png`), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  const reloaded = page.waitForEvent("domcontentloaded");
  await page.getByRole("button", { name: "Restore registration", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Registration restored", exact: true })).toBeVisible();
  await reloaded;
  await expect(page.getByText("This registration is cancelled", { exact: true })).toBeHidden();
  await expect(page.getByRole("button", { name: "Cancel my registration…", exact: true })).toBeVisible();
  // Registering signed the attendee in, so the portal opens with that session.
  const calendarResponse = await page.request.get(
    `/api/v1/events/${slug}/registrations/${submitted.result.registrationId}/calendar.ics`,
  );
  expect(calendarResponse.status(), await calendarResponse.text()).toBe(200);
  const calendar = (await calendarResponse.text()).replace(/\r?\n[ \t]/g, "");
  expect(calendar).toContain(`/portal/#/events/${slug}/registrations/${submitted.result.registrationId}`);
  expect(calendar).not.toContain("/register/manage/");
  expect(calendar).not.toContain(manageToken);
  await page.goto(`/portal/#/events/${slug}/ticket`);
  const enlargeCode = page.getByRole("button", { name: "Enlarge check-in code", exact: true });
  await expect(enlargeCode).toBeVisible();
  for (const [width, height, device] of [
    [1280, 900, "desktop"],
    [375, 812, "phone"],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.screenshot({ path: info.outputPath(`attendee-ticket-${device}.png`), fullPage: true });
  }
  await enlargeCode.click();
  const codeViewer = page.getByRole("dialog", { name: "Check-in code", exact: true });
  await expect(codeViewer).toBeVisible();
  await expect(codeViewer).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(codeViewer.getByText("Event Attendee", { exact: true })).toBeVisible();
  await expect(codeViewer.getByText("Conference attendee", { exact: true })).toBeVisible();
  await expect(codeViewer.getByText("Synthetic Attendee Services", { exact: true })).toBeVisible();
  expect(
    (await page.getByRole("img", { name: "Your check-in QR code", exact: true }).boundingBox())?.width,
  ).toBeGreaterThan(320);
  await expect(page.getByRole("img", { name: "Your check-in QR code", exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath("attendee-ticket-code-phone.png"), animations: "disabled" });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({ path: info.outputPath("attendee-ticket-code-desktop.png"), animations: "disabled" });
  await page.getByRole("button", { name: "Close check-in code", exact: true }).click();
});

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
  // An organization name belongs to the domain that first claimed it, so each run names its own.
  const runId = Date.now();
  const reviewEmail = `signup-review-${runId}@example.com`;
  await page.route("**/invites/*/info*", (route) => route.fulfill({ json: { status: "expired" } }));
  await page.goto(`${registrationPath}?invite=expired-invitation-test-token`);
  await expect(page.getByRole("heading", { name: "This invitation has expired" })).toBeVisible();
  const signInCard = page.locator("[data-registration-sign-in]").getByRole("region", { name: "Sign in", exact: true });
  await expect(signInCard).toBeHidden();
  await page.getByRole("button", { name: "Continue without invitation" }).click();
  await expect(signInCard).toBeVisible();
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
  await page.goto(`${registrationPath}?invite=valid-invitation-test-token&id=0b7e9d1c-5a4f-4c2e-9f3a-2d6b8e1c4a70`);
  // Signed out, the sign-in card stands in for the form: nothing is asked before the person is signed in.
  await expect(signInCard).toBeVisible();
  await expect(page.getByLabel("First name")).toHaveCount(0);
  for (const [width, height, device] of [
    [1280, 900, "desktop"],
    [375, 812, "phone"],
  ] as const) {
    await page.setViewportSize({ width, height });
    await signInCard.screenshot({ path: info.outputPath(`public-registration-sign-in-${device}.png`) });
  }
  await page.screenshot({ path: "test-results/registration-shared-fields.png", fullPage: true });
  await continueRegistrationWithEmail(page, {
    email: reviewEmail,
    firstName: "Signup",
    lastName: "Review",
    organization: `Signup Review Org ${runId}`,
  });
  await captureStep(page, info, 2, "attendance");
  await page.getByRole("button", { name: /^Choose On[- ]demand for every available day$/ }).click();
  await page.getByRole("button", { name: /Continue/ }).click();
  await page.getByLabel("Country").selectOption("US");
  await captureStep(page, info, 3, "questions");
  await page.getByRole("button", { name: /Continue/ }).click();
  const terms = page.locator("[data-term-key] input[required]");
  for (const term of await terms.all()) await term.check();
  await expect(page.getByRole("checkbox", { name: /photos and videos/i })).toBeChecked();
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

  const submissions: Array<{ inviteToken?: string | null; inviteId?: string | null }> = [];
  await page.route(`**/api/v1/events/${slug}/registrations`, (route) => {
    submissions.push(registrationCreateSchema.parse(route.request().postDataJSON()));
    return route.fulfill({ status: 400, json: { error: { code: "INVITE_EXPIRED", message: "Invitation expired" } } });
  });
  await page.getByRole("button", { name: "Register", exact: true }).click();
  await expect(page.getByRole("heading", { name: "This invitation has expired" })).toBeVisible();
  // The token left the address at sign-in; this browser kept it, so the first submission still carries it.
  expect(submissions[0]).toMatchObject({
    inviteToken: "valid-invitation-test-token",
    inviteId: "0b7e9d1c-5a4f-4c2e-9f3a-2d6b8e1c4a70",
  });
  await page.getByRole("button", { name: "Continue without invitation" }).click();
  await expect(page.locator("[data-registration-review]")).toContainText(reviewEmail);
  await page.getByRole("button", { name: "Register", exact: true }).click();
  await expect.poll(() => submissions.length).toBe(2);
  expect(submissions[1]?.inviteToken).toBeFalsy();
});
