import { expect, test } from "@playwright/test";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { signInToPortal } from "./helpers/portal-auth";

const SETTINGS_API = "/api/v1/system/membership-settings";
const CATEGORIES_API = "/api/v1/system/membership-categories";
const REMOVED_ADMIN_SETTINGS_API = "/api/v1/admin/membership-settings";

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
