import { expect, test } from "@playwright/test";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { signInToPortal } from "./helpers/portal-auth";

const PERMISSIONS_API = "/api/v1/permissions";
const ROLES_API = "/api/v1/roles";
const REMOVED_ADMIN_PREFIXES = ["/api/v1/admin/access-grants", "/api/v1/admin/roles", "/api/v1/admin/users"];

test("permitted staff manage a custom role through the System portal", async ({ page }) => {
  const permissionRequests: string[] = [];
  const retiredSystemRequests: string[] = [];
  const removedAdminRequests: string[] = [];
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (
      pathname === PERMISSIONS_API ||
      pathname.startsWith(`${PERMISSIONS_API}/`) ||
      pathname === ROLES_API ||
      pathname.startsWith(`${ROLES_API}/`)
    ) {
      permissionRequests.push(`${request.method()} ${pathname}`);
    }
    if (pathname === "/api/v1/system" || pathname.startsWith("/api/v1/system/")) {
      retiredSystemRequests.push(`${request.method()} ${pathname}`);
    }
    if (REMOVED_ADMIN_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) {
      removedAdminRequests.push(`${request.method()} ${pathname}`);
    }
  });

  await signInToPortal(page, e2eAdminEmail("portal-access-control"));
  await page.getByRole("link", { name: "System", exact: true }).click();
  await page.getByRole("link", { name: "Access Control" }).click();
  await page.getByRole("tab", { name: "Roles" }).click();

  const roleName = `e2e_access_${Date.now()}`;
  const createCard = page
    .getByText("Create a custom role", { exact: true })
    .locator("..", { has: page.locator("form") });
  await createCard.getByLabel("Name").fill(roleName);
  await createCard.getByLabel("Description").fill("Temporary browser-test role");

  const createResponse = page.waitForResponse(
    (response) => new URL(response.url()).pathname === ROLES_API && response.request().method() === "POST",
  );
  await createCard.getByRole("button", { name: "Create role" }).click();
  expect((await createResponse).status()).toBe(201);

  const roleRow = page.getByRole("row").filter({ has: page.getByText(roleName, { exact: true }) });
  await expect(roleRow).toBeVisible();
  page.once("dialog", (dialog) => void dialog.accept());
  const deleteResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname.startsWith(`${ROLES_API}/`) && response.request().method() === "DELETE",
  );
  await roleRow.getByRole("button", { name: "Delete" }).click();
  expect((await deleteResponse).status()).toBe(200);
  await expect(roleRow).toHaveCount(0);

  await page.goto("/portal/#/system/access-control");
  await expect(page).toHaveURL(/\/portal\/#\/system\/access-control$/);
  await expect(page.getByRole("link", { name: "Access Control" })).toBeVisible();

  expect(permissionRequests).toEqual(expect.arrayContaining([`GET ${PERMISSIONS_API}/grants`, `GET ${ROLES_API}`]));
  expect(retiredSystemRequests).toEqual([]);
  expect(removedAdminRequests).toEqual([]);
});
