import { expect, test } from "@playwright/test";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { signInToPortal } from "./helpers/portal-auth";

const FORMS_API = "/api/v1/forms";
const LEGACY_ADMIN_FORMS_API = "/api/v1/admin/forms";

test("permitted staff manage global forms through the canonical Forms resource", async ({ page }) => {
  const canonicalRequests: string[] = [];
  const legacyRequests: string[] = [];

  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname === FORMS_API || pathname.startsWith(`${FORMS_API}/`)) {
      canonicalRequests.push(`${request.method()} ${pathname}`);
    }
    if (pathname === LEGACY_ADMIN_FORMS_API || pathname.startsWith(`${LEGACY_ADMIN_FORMS_API}/`)) {
      legacyRequests.push(`${request.method()} ${pathname}`);
    }
  });

  await signInToPortal(page, e2eAdminEmail("portal-users"));
  await page.goto("/portal/#/forms");

  await expect(page.getByRole("link", { name: "Forms", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Forms", exact: true })).toBeVisible();
  await expect(
    page.locator("tbody tr").first().or(page.getByText("No forms configured").first()).first(),
  ).toBeVisible();

  const formKey = `e2e-form-${Date.now()}-${test.info().workerIndex}`;
  const formTitle = `E2E global form ${formKey}`;
  await page.getByRole("button", { name: "New form", exact: true }).click();
  const editor = page.locator("form").filter({ has: page.getByRole("button", { name: "Create form", exact: true }) });
  await editor.getByLabel("Key", { exact: true }).fill(formKey);
  await editor.getByLabel("Purpose", { exact: true }).selectOption("survey");
  await editor.getByLabel("Title", { exact: true }).fill(formTitle);
  await editor.getByLabel("Field key (lowercase, letters, digits, underscores)", { exact: true }).fill("feedback");
  await editor.getByLabel("Field label", { exact: true }).fill("Feedback");

  const createResponse = page.waitForResponse(
    (response) => new URL(response.url()).pathname === FORMS_API && response.request().method() === "POST",
  );
  await editor.getByRole("button", { name: "Create form", exact: true }).click();
  expect((await createResponse).status()).toBe(201);

  await expect(page.getByText(formTitle, { exact: true })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/portal/#/forms/${formKey.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}$`));

  await page.getByRole("tab", { name: "Edit", exact: true }).click();
  const updatedTitle = `${formTitle} updated`;
  const detailEditor = page
    .locator("form")
    .filter({ has: page.getByRole("button", { name: "Save form", exact: true }) });
  await detailEditor.getByLabel("Title", { exact: true }).fill(updatedTitle);
  const updateResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === `${FORMS_API}/${formKey}` && response.request().method() === "PATCH",
  );
  await detailEditor.getByRole("button", { name: "Save form", exact: true }).click();
  expect((await updateResponse).status()).toBe(200);
  await expect(page.getByText(updatedTitle, { exact: true })).toBeVisible();

  expect(canonicalRequests).toEqual(
    expect.arrayContaining([
      "GET /api/v1/forms",
      `POST /api/v1/forms`,
      `GET /api/v1/forms/${formKey}`,
      `PATCH /api/v1/forms/${formKey}`,
    ]),
  );
  expect(legacyRequests).toEqual([]);

  // Keep the shared E2E database tidy for subsequent specs without introducing
  // another UI path that this regression test would need to validate.
  await page.request.delete(`${FORMS_API}/${encodeURIComponent(formKey)}`);
});
