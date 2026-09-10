/**
 * @covers system.12.7
 */
import { expect, test } from "@playwright/test";
import {
  membershipApplicationFormDefinitionResponseSchema,
  membershipApplicationFormDefinitionUpdateSchema,
} from "../../assets/shared/schemas/membership-application-form";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { extractEmailUrl, capturedEmailCount, waitForCapturedEmail } from "./helpers/sendgrid";
import { openMembershipVerificationLink } from "./helpers/member-join";
import { signInToPortal } from "./helpers/portal-auth";

const SETTINGS_API = "/api/v1/membership/settings";
const CATEGORIES_API = "/api/v1/membership/categories";
const REMOVED_SYSTEM_SETTINGS_API = "/api/v1/system/membership-settings";
const REMOVED_SYSTEM_CATEGORIES_API = "/api/v1/system/membership-categories";
const REMOVED_ADMIN_SETTINGS_API = "/api/v1/admin/membership-settings";
const APPLICATION_FORM_DEFINITION_API = "/api/v1/members/applications/form/definition";
const LEGACY_ADMIN_FORMS_API = "/api/v1/admin/forms";

test("a permitted staff identity reads and updates membership settings through the portal", async ({ page }) => {
  const membershipRequests: string[] = [];
  const removedSystemRequests: string[] = [];
  const removedAdminRequests: string[] = [];

  // Observe the real Worker requests without stubbing or delaying them: this
  // keeps the parallel settings/category loads independent of test machinery.
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname === SETTINGS_API || pathname === CATEGORIES_API || pathname.startsWith(`${CATEGORIES_API}/`)) {
      membershipRequests.push(`${request.method()} ${pathname}`);
    }
    if (pathname === REMOVED_SYSTEM_SETTINGS_API || pathname === REMOVED_SYSTEM_CATEGORIES_API) {
      removedSystemRequests.push(`${request.method()} ${pathname}`);
    }
    if (pathname === REMOVED_ADMIN_SETTINGS_API) {
      removedAdminRequests.push(`${request.method()} ${pathname}`);
    }
  });

  await signInToPortal(page, e2eAdminEmail("portal-membership-settings"));
  // Three pages, three addresses. They shared one "Membership Settings" tab
  // before, so neither the workflow nor the catalog could be linked to (#40).
  await page.goto("/portal/#/settings/application-workflow");

  await expect(page.getByRole("heading", { name: "Application workflow" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Application workflow" })).toHaveAttribute("aria-current", "page");
  const consultationWindow = page.getByLabel("Consultation window (days)");
  await expect(consultationWindow).toHaveCount(0);
  async function editWorkflow() {
    await page.getByRole("button", { name: "Workflow settings actions" }).click();
    await page.getByRole("menuitem", { name: "Edit settings" }).click();
  }
  await editWorkflow();
  const originalWindow = await consultationWindow.inputValue();
  await consultationWindow.fill("999");
  await page.getByRole("button", { name: "Save workflow settings" }).click();
  await expect(consultationWindow).toHaveAttribute("aria-invalid", "true");
  expect(membershipRequests).not.toContain(`PATCH ${SETTINGS_API}`);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await editWorkflow();
  await expect(consultationWindow).toHaveValue(originalWindow);
  await expect(consultationWindow).toBeVisible();

  const updatedWindow = String(Number(await consultationWindow.inputValue()) + 1);
  const saveResponse = page.waitForResponse(
    (response) => new URL(response.url()).pathname === SETTINGS_API && response.request().method() === "PATCH",
  );
  await consultationWindow.fill(updatedWindow);
  await page.getByRole("button", { name: "Save workflow settings" }).click();
  expect((await saveResponse).status()).toBe(200);
  await expect(page.getByText("Membership workflow settings saved", { exact: true })).toBeVisible();
  await expect(consultationWindow).toHaveCount(0);
  await editWorkflow();
  await expect(consultationWindow).toHaveValue(updatedWindow);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();

  await page.goto("/portal/#/settings/membership-categories");
  await expect(page.getByRole("heading", { name: "Membership categories" })).toBeVisible();
  const categoryForm = page.getByRole("region", { name: "Category H8", exact: true });
  async function editCategory() {
    await categoryForm.getByRole("button", { name: "Category H8 actions" }).click();
    await page.getByRole("menuitem", { name: "Edit settings" }).click();
  }
  await expect(categoryForm.locator("input")).toHaveCount(0);
  await editCategory();
  const categoryLabel = categoryForm.getByLabel("Label");
  const updatedLabel = `${await categoryLabel.inputValue()} (E2E)`;
  const categoryResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === `${CATEGORIES_API}/H8` && response.request().method() === "PATCH",
  );
  await categoryLabel.fill(updatedLabel);
  await categoryForm.getByRole("button", { name: "Save category H8" }).click();
  expect((await categoryResponse).status()).toBe(200);
  await expect(page.getByText("Category H8 saved", { exact: true })).toBeVisible();
  await expect(categoryLabel).toHaveCount(0);
  await editCategory();
  await expect(categoryLabel).toHaveValue(updatedLabel);
  await categoryForm.getByRole("button", { name: "Cancel", exact: true }).click();

  expect(membershipRequests).toEqual(
    expect.arrayContaining([
      `GET ${SETTINGS_API}`,
      `GET ${CATEGORIES_API}`,
      `PATCH ${SETTINGS_API}`,
      `PATCH ${CATEGORIES_API}/H8`,
    ]),
  );
  expect(removedSystemRequests).toEqual([]);

  // Each edit survives a reload of the page it was made on, at that page's
  // own address.
  await page.goto("/portal/#/settings/application-workflow");
  await editWorkflow();
  await expect(page.getByLabel("Consultation window (days)")).toHaveValue(updatedWindow);
  await page.goto("/portal/#/settings/membership-categories");
  await editCategory();
  await expect(categoryForm.getByLabel("Label")).toHaveValue(updatedLabel);
  expect(removedAdminRequests).toEqual([]);
});

test("publishes membership application form edits to the public join flow", async ({ page }) => {
  const legacyAdminFormRequests: string[] = [];
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname === LEGACY_ADMIN_FORMS_API || pathname.startsWith(`${LEGACY_ADMIN_FORMS_API}/`)) {
      legacyAdminFormRequests.push(`${request.method()} ${pathname}`);
    }
  });

  await signInToPortal(page, e2eAdminEmail("portal-membership-form"));
  await page.goto("/portal/#/settings/membership-application-form");
  await expect(page.getByRole("heading", { name: "Membership application form" })).toBeVisible();

  const initialResponse = await page.request.get(APPLICATION_FORM_DEFINITION_API);
  expect(initialResponse.status()).toBe(200);
  const initial = membershipApplicationFormDefinitionResponseSchema.parse(await initialResponse.json());
  const field = initial.fields.find((candidate) => candidate.fieldType === "text");
  expect(field, "The seeded membership application must have an editable text field").toBeDefined();
  if (!field) throw new Error("No editable membership application text field was returned");

  const originalFields = initial.fields.map(
    ({ id, key, label, fieldType, required, options, optionSource, validation, sortOrder }) => ({
      id,
      key,
      label,
      fieldType,
      required,
      ...(options === null ? {} : { options }),
      ...(optionSource === null ? {} : { optionSource }),
      ...(validation === null ? {} : { validation }),
      sortOrder,
    }),
  );
  const marker = `E2E ${Date.now()}`;
  const changedLabel = `${field.label} (${marker})`;

  let changed = false;
  try {
    await expect(page.getByLabel("Form title", { exact: true })).toHaveCount(0);
    async function editForm() {
      await page.getByRole("button", { name: "Application form actions" }).click();
      await page.getByRole("menuitem", { name: "Edit form", exact: true }).click();
    }
    await editForm();
    await page.getByLabel("Form title", { exact: true }).fill("Unsaved application title");
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await editForm();
    await expect(page.getByLabel("Form title", { exact: true })).toHaveValue(initial.form.title);
    await page.locator("button.pk-formq").filter({ hasText: field.label }).click();
    await page.getByLabel("Question", { exact: true }).fill(changedLabel);
    const saving = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === APPLICATION_FORM_DEFINITION_API && response.request().method() === "PATCH",
    );
    await page.getByRole("button", { name: "Save form", exact: true }).click();
    const updateResponse = await saving;
    expect(updateResponse.status()).toBe(200);
    const updated = membershipApplicationFormDefinitionResponseSchema.parse(await updateResponse.json());
    expect(updated.fields.find((candidate) => candidate.id === field.id)?.label).toBe(changedLabel);
    changed = true;
    await expect(page.getByLabel("Form title", { exact: true })).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole("list", { name: "Membership application form fields" })).toContainText(changedLabel);

    const email = `membership-form-${Date.now()}@organization-e2e.test`;
    const sinceVerification = await capturedEmailCount();
    await page.goto("/join/");
    await page.getByLabel("Yes — I am employed by or own an organization").check();
    await page.getByLabel("Your official work or organization email address").fill(email);
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();

    const verification = await waitForCapturedEmail(email, "Verify your email address", {
      since: sinceVerification,
    });
    await openMembershipVerificationLink(page, extractEmailUrl(verification, "#verify="));
    await expect(page.getByRole("heading", { name: "Membership Application", exact: true })).toBeVisible();
    await expect(page.getByLabel(changedLabel, { exact: true })).toBeVisible();
    expect(legacyAdminFormRequests).toEqual([]);
  } finally {
    if (changed) {
      const currentResponse = await page.request.get(APPLICATION_FORM_DEFINITION_API);
      expect(currentResponse.status()).toBe(200);
      const current = membershipApplicationFormDefinitionResponseSchema.parse(await currentResponse.json());
      const restore = membershipApplicationFormDefinitionUpdateSchema.parse({
        expectedUpdatedAt: current.form.updatedAt,
        fields: originalFields,
      });
      const restoreResponse = await page.request.patch(APPLICATION_FORM_DEFINITION_API, { data: restore });
      expect(restoreResponse.status()).toBe(200);
    }
  }
});
