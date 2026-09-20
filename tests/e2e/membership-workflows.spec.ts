import { expect, test } from "@playwright/test";
import { signInAsE2eStaff } from "./helpers/staff-auth";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { submitMembershipApplication, uniqueSuffix } from "./helpers/membership";
import { jsonResponse } from "./helpers/member-provisioning";
import { membershipWorkflowVersionResponseSchema } from "../../assets/shared/schemas/membership-workflows";

/** @covers system.12.7 */
test("changes an existing organization category's workflow and completes its required staff review", async ({
  page,
}, testInfo) => {
  await signInAsE2eStaff(page, e2eAdminEmail("membership-workflows"));
  const suffix = uniqueSuffix();
  const name = `Organization admission ${suffix}`;
  await page.goto("/portal/#/settings/application-workflow");
  await page.getByRole("button", { name: "New workflow", exact: true }).click();
  await page.getByLabel("Workflow name").fill(name);
  await page.getByLabel("Policy reference").fill("Synthetic policy for Example Organization browser verification");
  await page.getByLabel("Step name").fill("");
  await page.getByRole("button", { name: "Done editing", exact: true }).click();
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByText(/Step 1 needs attention:/)).toBeVisible();
  await expect(page.getByText("Step 1 needs attention: Enter a step name.", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Step name")).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath("workflow-step-validation.png"), fullPage: true });
  await page.getByLabel("Step name").fill("Review the application form");
  await expect(page.getByText(/Step 1 needs attention:/)).toHaveCount(0);
  await page
    .getByLabel("Applicant instructions")
    .fill("Staff check the organization and the user who submitted the form.");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page).toHaveURL(/application-workflow\/[a-f0-9-]+$/);
  const versionId = page.url().split("/").at(-1)!;
  await page.getByLabel("Policy adoption reason").fill("Authorize this synthetic organization admission policy.");
  await page.getByRole("button", { name: "Publish version 1", exact: true }).click();
  await expect(page.getByRole("button", { name: "Create new draft", exact: true })).toBeVisible();
  const published = membershipWorkflowVersionResponseSchema.parse(
    await jsonResponse(page.request, "GET", `/api/v1/membership/workflows/versions/${versionId}`),
  );
  expect(published.workflow.status).toBe("published");
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath("published-workflow.png"), fullPage: true });
  const code = "A";
  await page.goto(`/portal/#/settings/membership-categories/${code}`);
  const picker = page.getByRole("combobox", { name: "Membership workflow" });
  await expect(picker).toBeVisible();
  await expect(picker).toHaveValue(/Standard membership/);
  await picker.click();
  await expect(page.getByRole("option").filter({ hasText: name })).toBeVisible();
  await picker.fill(name);
  await page.getByRole("option").filter({ hasText: name }).click();
  await picker.click();
  await expect(page.getByRole("option").filter({ hasText: "Standard membership" })).toBeVisible();
  await picker.press("Escape");
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath("existing-category-workflow.png"), fullPage: true });
  await page.getByRole("button", { name: `Save category ${code}`, exact: true }).click();
  await expect(page).toHaveURL(/membership-categories$/);
  await page.goto(`/portal/#/settings/membership-categories/${code}`);
  await expect(picker).toHaveValue(`${name} · version 1`);
  const application = await submitMembershipApplication(page, {
    email: `user@organization-${suffix}.test`,
    name: "Example User",
    category: code,
    organizationName: "Example Organization",
  });
  await jsonResponse(page.request, "POST", "/api/v1/scheduler/jobs/membership_workflows/runs", {});
  await page.goto(`/portal/#/membership/applications/${application.applicationId}/review`);
  await expect(page.getByRole("heading", { name: "Example Organization", exact: true })).toBeVisible();
  await page
    .getByLabel("Review decision and reason")
    .fill("Verified the organization details and the user's authority from the submitted form.");
  await page.getByRole("button", { name: "Complete review", exact: true }).click();
  await expect(page.getByText("Approved", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Complete review", exact: true })).toHaveCount(0);
  await expect(page.getByRole("table", { name: "Review objections" })).toBeVisible();
  await expect(page.getByText("Internal server error", { exact: true })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("heading", { name: "Example Organization", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath("approved-workflow-mobile.png"), fullPage: true });
});

/** @covers system.12.7 */
test("creates, renames, and reorders organization categories from their forms and table", async ({
  page,
}, testInfo) => {
  await signInAsE2eStaff(page, e2eAdminEmail("membership-workflows"));
  const code = `ORG_${Date.now()}`;
  const renamed = `${code}_NEW`;
  await page.goto("/portal/#/settings/membership-categories/new");
  await page.getByLabel(/^Code/).fill(code);
  await page.getByLabel(/^Name/).fill("Example Organization category");
  await page.getByLabel("Category", { exact: true }).selectOption("organization");
  await page
    .getByLabel("Description", { exact: true })
    .fill("Organizations joining through the membership application form.");
  await expect(page.getByLabel("Display order", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Create category", exact: true }).click();
  await expect(page).toHaveURL(/membership-categories$/);
  await page.goto(`/portal/#/settings/membership-categories/${code}`);
  await page.getByLabel(/^Code/).fill(renamed);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath("category-form.png"), fullPage: true });
  await page.getByRole("button", { name: `Save category ${code}`, exact: true }).click();
  await expect(page).toHaveURL(/membership-categories$/);
  const rows = page.getByRole("table", { name: "Membership categories" }).locator("tbody tr");
  await expect(rows.last()).toContainText(renamed);
  await page.getByRole("button", { name: `Actions for category ${renamed}`, exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "Move down", exact: true })).toBeDisabled();
  await page.getByRole("menuitem", { name: "Move up", exact: true }).click();
  await expect(rows.nth((await rows.count()) - 2)).toContainText(renamed);
  await page.reload();
  await expect(rows.nth((await rows.count()) - 2)).toContainText(renamed);
  await page.goto(`/portal/#/settings/membership-categories/${renamed}`);
  await expect(page.getByLabel(/^Code/)).toHaveValue(renamed);
  await expect(page.getByLabel("Category", { exact: true })).toBeDisabled();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("category-form-mobile.png"), fullPage: true });
});
