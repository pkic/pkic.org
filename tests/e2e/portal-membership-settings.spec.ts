import { expect, test } from "@playwright/test";
import {
  membershipApplicationFormDefinitionResponseSchema,
  membershipApplicationFormDefinitionUpdateSchema,
} from "../../assets/shared/schemas/membership-application-form";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { extractEmailUrl, capturedEmailCount, waitForCapturedEmail } from "./helpers/sendgrid";
import { signInToPortal } from "./helpers/portal-auth";

const SETTINGS_API = "/api/v1/system/membership-settings";
const CATEGORIES_API = "/api/v1/system/membership-categories";
const REMOVED_ADMIN_SETTINGS_API = "/api/v1/admin/membership-settings";
const APPLICATION_FORM_DEFINITION_API = "/api/v1/members/applications/form/definition";
const LEGACY_ADMIN_FORMS_API = "/api/v1/admin/forms";

test("a permitted staff identity reads and updates membership settings through the portal", async ({ page }) => {
  const systemRequests: string[] = [];
  const removedAdminRequests: string[] = [];

  // Observe the real Worker requests without stubbing or delaying them: this
  // keeps the parallel settings/category loads independent of test machinery.
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname === SETTINGS_API || pathname === CATEGORIES_API || pathname.startsWith(`${CATEGORIES_API}/`)) {
      systemRequests.push(`${request.method()} ${pathname}`);
    }
    if (pathname === REMOVED_ADMIN_SETTINGS_API) {
      removedAdminRequests.push(`${request.method()} ${pathname}`);
    }
  });

  await signInToPortal(page, e2eAdminEmail("portal-system-audit"));
  await page.goto("/portal/#/system/membership-settings");

  await expect(page.getByRole("link", { name: "Membership Settings" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Application workflow" })).toBeVisible();
  const consultationWindow = page.getByLabel("Consultation window (days)");
  await expect(consultationWindow).toBeVisible();

  const updatedWindow = String(Number(await consultationWindow.inputValue()) + 1);
  const saveResponse = page.waitForResponse(
    (response) => new URL(response.url()).pathname === SETTINGS_API && response.request().method() === "PATCH",
  );
  await consultationWindow.fill(updatedWindow);
  await page.getByRole("button", { name: "Save workflow settings" }).click();
  expect((await saveResponse).status()).toBe(200);
  await expect(page.getByText("Membership workflow settings saved", { exact: true })).toBeVisible();
  await expect(consultationWindow).toHaveValue(updatedWindow);

  const categoryForm = page.getByRole("heading", { name: "Category H8" }).locator("xpath=ancestor::form");
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
  await expect(categoryLabel).toHaveValue(updatedLabel);

  expect(systemRequests).toEqual(
    expect.arrayContaining([
      `GET ${SETTINGS_API}`,
      `GET ${CATEGORIES_API}`,
      `PATCH ${SETTINGS_API}`,
      `PATCH ${CATEGORIES_API}/H8`,
    ]),
  );

  await page.goto("/admin/#/membership/settings");
  await expect(page).toHaveURL(/\/portal\/#\/system\/membership-settings$/);
  await expect(page.getByRole("heading", { name: "Application workflow" })).toBeVisible();
  await expect(page.getByLabel("Consultation window (days)")).toHaveValue(updatedWindow);
  await expect(
    page.getByRole("heading", { name: "Category H8" }).locator("xpath=ancestor::form").getByLabel("Label"),
  ).toHaveValue(updatedLabel);
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

  await signInToPortal(page, e2eAdminEmail("portal-system-audit"));
  await page.goto("/portal/#/system/membership-settings");
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
  const changedFields = originalFields.map((candidate) =>
    candidate.id === field.id ? { ...candidate, label: changedLabel } : candidate,
  );
  const update = membershipApplicationFormDefinitionUpdateSchema.parse({
    expectedUpdatedAt: initial.form.updatedAt,
    fields: changedFields,
  });

  let changed = false;
  try {
    const updateResponse = await page.request.patch(APPLICATION_FORM_DEFINITION_API, { data: update });
    expect(updateResponse.status()).toBe(200);
    const updated = membershipApplicationFormDefinitionResponseSchema.parse(await updateResponse.json());
    expect(updated.fields.find((candidate) => candidate.id === field.id)?.label).toBe(changedLabel);
    changed = true;

    const email = `membership-form-${Date.now()}@organization-e2e.test`;
    const sinceVerification = await capturedEmailCount();
    await page.goto("/join/");
    await page.getByLabel("Work or organization email address").fill(email);
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();

    const verification = await waitForCapturedEmail(email, "Verify your email address", {
      since: sinceVerification,
    });
    await page.goto(extractEmailUrl(verification, "#verify="));
    await page.reload();
    await expect(page.getByRole("heading", { name: "Membership application", exact: true })).toBeVisible();
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
