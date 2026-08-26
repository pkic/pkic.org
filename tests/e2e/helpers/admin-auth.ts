import { expect, type Page } from "@playwright/test";
import { capturedEmailCount, extractEmailUrl, waitForCapturedEmail } from "./sendgrid";

export async function signInAsE2eAdmin(page: Page, email: string): Promise<void> {
  await page.goto("/admin/");
  await expect(page.locator("#form-magic")).toBeVisible({ timeout: 10_000 });
  await page.locator("#inp-email").fill(email);
  const since = await capturedEmailCount();
  await page.locator("#btn-send").click();
  await expect(page.locator("#magic-sent")).toBeVisible({ timeout: 10_000 });
  const emailMessage = await waitForCapturedEmail(email, "sign-in", { since });
  await page.goto(extractEmailUrl(emailMessage, "/admin/"));
  await expect(page.locator("#admin-root")).toBeVisible({ timeout: 15_000 });
}
