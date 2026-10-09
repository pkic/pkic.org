import { expect, test } from "@playwright/test";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { signInAsE2eStaff } from "./helpers/staff-auth";
import { submitMembershipApplication, uniqueSuffix } from "./helpers/membership";

/** @covers join.1.5 */
test("completes staff review and queues consultation for an organization's standard application", async ({
  page,
}, testInfo) => {
  const suffix = uniqueSuffix();
  const organizationName = `Example Organization ${suffix}`;
  const application = await submitMembershipApplication(page, {
    email: `user@organization-${suffix}.test`,
    name: "Example User",
    category: "F",
    organizationName,
  });
  await signInAsE2eStaff(page, e2eAdminEmail("membership-workflows"));
  await page.goto(`/portal/#/membership/applications/${application.applicationId}/review`);
  await expect(page.getByRole("heading", { name: "Example User", exact: true })).toBeVisible();
  await expect(page.getByText(organizationName, { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Complete staff review", exact: true })).toBeVisible();
  await page
    .getByLabel("Review decision and reason")
    .fill("Verified the application form, organization details, and submitting user's authority.");
  await page.getByRole("button", { name: "Complete review", exact: true }).click();
  await expect(page.getByRole("button", { name: "Complete review", exact: true })).toHaveCount(0);
  const requirements = page.getByRole("region", { name: "Membership requirements", exact: true });
  const staff = requirements
    .getByRole("listitem")
    .filter({ has: page.getByRole("heading", { name: "Staff review", exact: true }) });
  const consultation = requirements
    .getByRole("listitem")
    .filter({ has: page.getByRole("heading", { name: "Member consultation", exact: true }) });
  await expect(staff.getByText("Complete", { exact: true })).toBeVisible();
  await expect(consultation.getByText("Active", { exact: true })).toBeVisible();
  await expect(page.getByText(/No template configured/)).toHaveCount(0);
  await page.reload();
  await expect(staff.getByText("Complete", { exact: true })).toBeVisible();
  await expect(consultation.getByText("Active", { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("completed-staff-review.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("heading", { name: "Example User", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("completed-staff-review-mobile.png"), fullPage: true });
});
