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
  await page.goto(`/portal/#/membership/applications/${application.applicationId}`);
  await page.getByRole("button", { name: "Application actions", exact: true }).click();
  await page.getByRole("menuitem", { name: "Edit application…", exact: true }).click();
  await page.getByLabel("Contribution type", { exact: true }).selectOption("active");
  await page.getByLabel("Wants to present").check();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("button", { name: "Save", exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByText("Actively contribute to the consortium and its mission", { exact: true })).toBeVisible();
  await expect(page.getByText("Bylaws, Code of Conduct, IPR Policy", { exact: true })).toBeVisible();
  const sections = page.getByRole("navigation", { name: "Application sections", exact: true });
  await sections.getByRole("link", { name: "Review workflow and objections", exact: true }).click();
  await expect(sections.getByRole("link", { name: "Review workflow and objections", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await sections.getByRole("link", { name: "Application", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${application.applicationId}$`));
  await page.goto(`/portal/#/membership/applications/${application.applicationId}/review`);
  await expect(page.getByRole("heading", { name: "Example User", exact: true })).toBeVisible();
  await page
    .getByLabel("Review decision and reason")
    .fill("Verified the organization details and the user's authority from the submitted form.");
  await page.getByRole("button", { name: "Complete review", exact: true }).click();
  await expect(page.getByText("Approved", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Complete review", exact: true })).toHaveCount(0);
  await expect(page.getByRole("table", { name: "Review objections" })).toBeVisible();
  await expect(page.getByText("Internal server error", { exact: true })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("heading", { name: "Example User", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath("approved-workflow-mobile.png"), fullPage: true });
});

/** @covers system.12.7 */
test("creates, renames, and reorders organization categories from their forms and table", async ({
  page,
}, testInfo) => {
  await signInAsE2eStaff(page, e2eAdminEmail("membership-workflows-categories"));
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

/** @covers system.12.7 */
test("explains payment references and removes unused organization workflow versions", async ({ page }, testInfo) => {
  await signInAsE2eStaff(page, e2eAdminEmail("membership-workflows-archive"));
  await page.goto("/portal/#/settings/application-workflow/new");
  const name = `Unused organization workflow ${uniqueSuffix()}`;
  await page.getByLabel("Workflow name").fill(name);
  await page.getByLabel("Policy reference").fill("Synthetic organization policy for browser verification");
  await page.getByRole("button", { name: "Add payment confirmation", exact: true }).click();
  const reference = page.getByLabel(/^Fee or product reference/);
  await expect(reference).toHaveAccessibleDescription(/Enter a short name.*Applicants see it at checkout/);
  await reference.fill("Example Organization membership");
  await page.screenshot({ path: testInfo.outputPath("payment-reference-help.png"), fullPage: true });
  await page.getByRole("button", { name: "Remove step", exact: true }).last().click();
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page).toHaveURL(/application-workflow\/[a-f0-9-]+$/);
  const draftId = page.url().split("/").at(-1)!;
  await page.getByRole("button", { name: "Delete draft…", exact: true }).click();
  await page.getByLabel("Reason for removal").fill("This unused organization policy draft is no longer needed.");
  await page.getByRole("button", { name: "Delete draft", exact: true }).click();
  await expect(page).toHaveURL(/application-workflow\?workflows\.f\.archived=false$/);
  expect((await page.request.get(`/api/v1/membership/workflows/versions/${draftId}`)).status()).toBe(404);
  await page.getByRole("button", { name: "New workflow", exact: true }).click();
  await page.getByLabel("Workflow name").fill(`${name} published`);
  await page.getByLabel("Policy reference").fill("Synthetic policy approved only for this browser verification");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await page.getByLabel("Policy adoption reason").fill("Verify archival of an unassigned published policy.");
  await page.getByRole("button", { name: "Publish version 1", exact: true }).click();
  await page.getByRole("button", { name: "Archive version…", exact: true }).click();
  await page.getByLabel("Reason for removal").fill("Replaced by another synthetic organization policy.");
  await page.screenshot({ path: testInfo.outputPath("workflow-archive-confirmation.png"), fullPage: true });
  await page.getByRole("button", { name: "Archive version", exact: true }).click();
  await expect(page).toHaveURL(/application-workflow\?workflows\.f\.archived=false$/);
});

/** @covers system.12.7 */
test("navigates workflow breadcrumbs between settings, the list, and an organization policy form", async ({
  page,
}, testInfo) => {
  await signInAsE2eStaff(page, e2eAdminEmail("membership-workflows-breadcrumbs"));
  await page.goto("/portal/#/settings/application-workflow");
  const breadcrumb = page.getByRole("navigation", { name: "Breadcrumb", exact: true });
  await expect(breadcrumb.locator('[aria-current="page"]')).toHaveText("Application workflows");
  await breadcrumb.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(page).toHaveURL(/#\/settings$/);
  await page.goto("/portal/#/settings/application-workflow/new");
  await expect(breadcrumb.locator('[aria-current="page"]')).toHaveText("New membership workflow");
  const name = `Example Organization admission ${uniqueSuffix()}`;
  await page.getByLabel("Workflow name").fill(name);
  await page.getByLabel("Policy reference").fill("Review the organization's form and submitting user's authority.");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(breadcrumb.locator('[aria-current="page"]')).toHaveText(`${name} · version 1`);
  const workflowUrl = page.url();
  await page.reload();
  await expect(breadcrumb.locator('[aria-current="page"]')).toHaveText(`${name} · version 1`);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(breadcrumb).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("workflow-breadcrumb-mobile.png"), fullPage: true });
  const listLink = breadcrumb.getByRole("link", { name: "Application workflows", exact: true });
  await listLink.focus();
  await listLink.press("Enter");
  await expect(page).toHaveURL(/#\/settings\/application-workflow(?:\?|$)/);
  await expect(page.getByRole("table", { name: "Membership workflow versions" })).toBeVisible();
  await page.goto(workflowUrl);
  await breadcrumb.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(page).toHaveURL(/#\/settings$/);
});
