import { expect, type Page } from "@playwright/test";
import { signInToPortal } from "./portal-auth";

export async function expectStaffSessionLanding(page: Page): Promise<void> {
  await expect(page.locator("#portal-root")).toBeVisible({ timeout: 15_000 });
  await expect(page).toHaveURL(/\/portal\/#\//);
  await expect(page.locator("#portal-inp-email")).toHaveCount(0);
}

export async function signInAsE2eStaff(page: Page, email: string): Promise<void> {
  await signInToPortal(page, email);
  await expectStaffSessionLanding(page);
}
