/**
 * @covers form.6.1
 * @covers form.6.2
 */
import { expect, test } from "@playwright/test";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { signInToPortal } from "./helpers/portal-auth";
import { tab } from "./helpers/tabs";
import { acceptConfirmDialog } from "./helpers/confirm-dialog";

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

  // Creation is its own view: the forms table is gone, not layered below
  // the editor, and "new" is a reserved key in the /forms/:formKey route.
  await expect(page).toHaveURL(/\/portal\/#\/forms\/new$/);
  await expect(page.locator("tbody tr")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "New form", exact: true })).toHaveCount(0);

  // Cancel returns to the list without creating anything.
  await page.getByRole("button", { name: "← All forms", exact: true }).click();
  await expect(page).toHaveURL(/\/portal\/#\/forms$/);
  await expect(page.getByRole("button", { name: "New form", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "New form", exact: true }).click();
  await expect(page).toHaveURL(/\/portal\/#\/forms\/new$/);
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

  // Success navigates straight to the created form's own detail view.
  await expect(page.getByText(formTitle, { exact: true })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/portal/#/forms/${formKey.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}$`));

  await tab(page, "Edit").click();
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

test("permitted staff filter the forms list by Purpose and Status, and archive/delete through the UI", async ({
  page,
}) => {
  await signInToPortal(page, e2eAdminEmail("portal-users"));
  await page.goto("/portal/#/forms");

  const formKey = `e2e-form-filter-${Date.now()}-${test.info().workerIndex}`;
  const formTitle = `E2E filterable form ${formKey}`;
  await page.getByRole("button", { name: "New form", exact: true }).click();
  const editor = page.locator("form").filter({ has: page.getByRole("button", { name: "Create form", exact: true }) });
  await editor.getByLabel("Key", { exact: true }).fill(formKey);
  await editor.getByLabel("Purpose", { exact: true }).selectOption("survey");
  await editor.getByLabel("Title", { exact: true }).fill(formTitle);
  await editor.getByLabel("Field key (lowercase, letters, digits, underscores)", { exact: true }).fill("feedback");
  await editor.getByLabel("Field label", { exact: true }).fill("Feedback");
  await editor.getByRole("button", { name: "Create form", exact: true }).click();
  await expect(page.getByText(formTitle, { exact: true })).toBeVisible();

  await page.goto("/portal/#/forms");
  const formRow = page.locator("tr").filter({ hasText: formTitle });
  await expect(formRow).toBeVisible();

  // Purpose column filter: "survey" (what this form is) keeps the row,
  // "feedback" (a different purpose) hides it.
  await page.getByRole("button", { name: "Purpose column options" }).click();
  await page.getByRole("menuitemradio", { name: "survey" }).click();
  await expect(formRow).toBeVisible();
  await page.getByRole("button", { name: "Purpose column options" }).click();
  await page.getByRole("menuitemradio", { name: "feedback" }).click();
  await expect(formRow).toHaveCount(0);
  await page.getByRole("button", { name: "Purpose column options" }).click();
  await page.getByRole("menuitemradio", { name: "All purposes" }).click();
  await expect(formRow).toBeVisible();

  // Status column filter: a new form starts "active".
  await page.getByRole("button", { name: "Status column options" }).click();
  await page.getByRole("menuitemradio", { name: "active", exact: true }).click();
  await expect(formRow).toBeVisible();
  await page.getByRole("button", { name: "Status column options" }).click();
  await page.getByRole("menuitemradio", { name: "archived" }).click();
  await expect(formRow).toHaveCount(0);
  await page.getByRole("button", { name: "Status column options" }).click();
  await page.getByRole("menuitemradio", { name: "All statuses" }).click();
  await expect(formRow).toBeVisible();

  // The search box narrows by the same free-text the API accepts.
  const search = page.getByPlaceholder("Search forms…");
  await search.fill(formKey);
  await search.press("Enter");
  await expect(formRow).toBeVisible();
  await search.fill("no-such-form-key-anywhere");
  await search.press("Enter");
  await expect(formRow).toHaveCount(0);
  await search.fill("");
  await search.press("Enter");

  // Archive/Delete through the UI itself, not a raw API cleanup call — the
  // only path a staff operator actually has for retiring a form.
  await formRow.click();
  await expect(page.getByText(formTitle, { exact: true })).toBeVisible();
  const deleteResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === `${FORMS_API}/${formKey}` && response.request().method() === "DELETE",
  );
  await page.getByRole("button", { name: "Archive/Delete", exact: true }).click();
  await acceptConfirmDialog(page, "Archive or delete form");
  expect((await deleteResponse).status()).toBe(200);

  await page.goto("/portal/#/forms");
  await expect(page.locator("tr").filter({ hasText: formTitle })).toHaveCount(0);
});
