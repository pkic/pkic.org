import { expect, type Page } from "@playwright/test";
import {
  registrationCreateSchema,
  registrationSubmissionResponseSchema,
} from "../../../assets/shared/schemas/registration";

const REGISTRATION_PAGE = "/events/2026/pqc-conference-amsterdam-nl/register/";
const REGISTRATION_API = "/api/v1/events/pqc-conference-amsterdam-nl/registrations";

export async function registerInBrowser(page: Page, email: string, identityName?: string) {
  await page.goto(REGISTRATION_PAGE);
  if (identityName) {
    const picker = page.getByRole("combobox", { name: "Event identity", exact: true });
    await picker.fill(identityName);
    await page.getByRole("option", { name: identityName, exact: true }).click();
    await expect(page.getByLabel("Work email")).toHaveValue(email);
    await expect(page.getByLabel("First name")).toHaveValue("Event");
  } else {
    await page.getByLabel("First name").fill("Event");
    await page.getByLabel("Last name").fill("Attendee");
    await page.getByLabel("Work email").fill(email);
  }
  await page.getByRole("button", { name: /Continue/i }).click();
  for (const day of ["2026-12-01", "2026-12-02", "2026-12-03"]) {
    await page.locator(`label[for="dayAttendance-${day}-on_demand"]`).click();
  }
  await page.getByRole("button", { name: /Continue/i }).click();
  if (identityName) {
    await expect(page.getByLabel("Organization", { exact: true })).toHaveValue(identityName);
    await expect(page.getByLabel("Organization", { exact: true })).toHaveAttribute("readonly", "");
    await page.getByLabel("Job title", { exact: true }).fill("Conference attendee");
  } else {
    await page.getByLabel("Organization", { exact: true }).fill("Event attribution only");
    await page.getByLabel("Job title", { exact: true }).fill("Attendee");
  }
  await page.getByLabel("Country", { exact: true }).selectOption("US");
  await page.getByRole("button", { name: /Continue/i }).click();
  if (identityName) await expect(page.locator("[data-registration-review]")).toContainText(identityName);
  await page.locator('label[for="registration-email-review-confirmed"]').click();
  for (const term of [/privacy policy/i, /code of conduct/i, /photos and videos/i]) {
    await page.getByRole("checkbox", { name: term }).check();
  }
  const submitted = page.waitForResponse(
    (response) => new URL(response.url()).pathname === REGISTRATION_API && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: /Submit registration/i }).click();
  const response = await submitted;
  expect(response.status(), await response.text()).toBe(200);
  return {
    result: registrationSubmissionResponseSchema.parse(await response.json()),
    request: registrationCreateSchema.parse(response.request().postDataJSON()),
  };
}
