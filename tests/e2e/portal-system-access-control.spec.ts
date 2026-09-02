import { runRowAction } from "./helpers/data-table";
import { expect, test } from "@playwright/test";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { signInToPortal } from "./helpers/portal-auth";
import { acceptConfirmDialog } from "./helpers/confirm-dialog";
import { tab } from "./helpers/tabs";

const PERMISSIONS_API = "/api/v1/permissions";
const ROLES_API = "/api/v1/roles";
const REMOVED_ADMIN_PREFIXES = ["/api/v1/admin/access-grants", "/api/v1/admin/roles", "/api/v1/admin/users"];

test("permitted staff manage a custom role through the Settings portal", async ({ page }) => {
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
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByRole("link", { name: "Access Control" }).click();
  await expect(page).toHaveURL(/\/portal\/#\/system\/access-control\/grants$/);

  // Tabs are URL-addressed — switching to Roles navigates to its canonical URL.
  await tab(page, "Roles").click();
  await expect(page).toHaveURL(/\/portal\/#\/system\/access-control\/roles$/);

  // Creation lives behind an explicit action, list-first — no inline create form.
  await expect(page.getByText("New role", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "New role" }).click();
  await expect(page).toHaveURL(/\/portal\/#\/system\/access-control\/roles\/new$/);

  const roleName = `e2e_access_${Date.now()}`;
  // The form names itself, so it is reached by that name rather than by climbing
  // from the heading to a parent that happens to contain it: the heading now
  // lives in the panel's own header, a sibling of the body holding the form.
  const createCard = page.getByRole("form", { name: "New role" });
  await expect(createCard).toBeVisible();
  await createCard.getByLabel("Name").fill(roleName);
  await createCard.getByLabel("Description").fill("Temporary browser-test role");

  const createResponse = page.waitForResponse(
    (response) => new URL(response.url()).pathname === ROLES_API && response.request().method() === "POST",
  );
  await createCard.getByRole("button", { name: "Create role" }).click();
  expect((await createResponse).status()).toBe(201);

  // Creation navigates straight into the new role's URL-addressed detail.
  await expect(page).toHaveURL(/\/portal\/#\/system\/access-control\/roles\/[^/]+$/);
  await expect(page.getByRole("heading", { name: roleName })).toBeVisible();

  // The role's edit is reachable from its detail, guarded by the shared PATCH contract.
  await page.getByRole("button", { name: "Edit" }).click();
  const editForm = page.locator("form", { has: page.getByRole("button", { name: "Save changes" }) });
  await editForm.getByLabel("Description").fill("Updated browser-test role");
  const updateResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname.startsWith(`${ROLES_API}/`) && response.request().method() === "PATCH",
  );
  await editForm.getByRole("button", { name: "Save changes" }).click();
  expect((await updateResponse).status()).toBe(200);
  await expect(page.getByText("Updated browser-test role", { exact: true })).toBeVisible();

  // Assignees are visible on the same detail view, reachable without a separate destination.
  await expect(page.getByText("Assignees", { exact: true })).toBeVisible();
  await expect(page.getByText("No one holds this role", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "← All roles" }).click();
  await expect(page).toHaveURL(/\/portal\/#\/system\/access-control\/roles$/);

  const roleRow = page.getByRole("row").filter({ has: page.getByText(roleName, { exact: true }) });
  await expect(roleRow).toBeVisible();
  const deleteResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname.startsWith(`${ROLES_API}/`) && response.request().method() === "DELETE",
  );
  // A row's action names the role it acts on, so a page of rows no longer
  // offers a column of controls all called "Row actions".
  await runRowAction(page, roleRow, "Delete role");
  await acceptConfirmDialog(page, "Delete role");
  expect((await deleteResponse).status()).toBe(200);
  await expect(roleRow).toHaveCount(0);

  // The former "Staff" tab is now labeled People, without renaming the
  // underlying user_roles-backed schema fields it reads and writes.
  await tab(page, "People").click();
  await expect(page).toHaveURL(/\/portal\/#\/system\/access-control\/people$/);
  await expect(page.getByText("Staff management", { exact: true })).toHaveCount(0);

  await page.goto("/portal/#/system/access-control");
  await expect(page).toHaveURL(/\/portal\/#\/system\/access-control\/grants$/);
  await expect(page.getByRole("link", { name: "Access Control" })).toBeVisible();

  expect(permissionRequests).toEqual(expect.arrayContaining([`GET ${PERMISSIONS_API}/grants`, `GET ${ROLES_API}`]));
  expect(permissionRequests.some((request) => request.startsWith(`PATCH ${ROLES_API}/`))).toBe(true);
  expect(retiredSystemRequests).toEqual([]);
  expect(removedAdminRequests).toEqual([]);
});

/**
 * The Grants tab's "New grant" form is a second call site of `UserPicker`
 * (against `/api/v1/permissions/subjects`, not the default `/api/v1/users`
 * the organizations surface uses) that had zero browser coverage before this
 * — the search-and-select sequence itself, not just the API it eventually
 * calls, is what a schema mismatch in the shared picker breaks.
 */
test("permitted staff grant and revoke a permission through the Grants tab", async ({ page }) => {
  const staffEmail = e2eAdminEmail("portal-access-control");
  await signInToPortal(page, staffEmail);
  await page.goto("/portal/#/system/access-control/grants");

  await page.getByRole("button", { name: "New grant", exact: true }).click();
  const grantForm = page.getByRole("form", { name: "Grant a permission" });
  await expect(grantForm).toBeVisible();

  const search = grantForm.getByLabel("Search for a user");
  await search.fill(staffEmail);
  const matches = page.getByRole("group", { name: "Matching users" });
  const matchButton = matches.getByRole("button", { name: new RegExp(staffEmail.replace(/[.]/g, "\\.")) });
  await expect(matchButton).toBeVisible({ timeout: 10_000 });
  await matchButton.click();
  await expect(search).toHaveValue(staffEmail);

  const grantResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/v1/permissions/grants" && response.request().method() === "POST",
  );
  await grantForm.getByRole("button", { name: "Grant permission" }).click();
  expect((await grantResponse).status()).toBe(201);
  await expect(page.getByText("Permission granted", { exact: true })).toBeVisible();

  const grantRow = page.getByRole("row").filter({ hasText: staffEmail }).filter({ hasText: "membership:read" });
  await expect(grantRow).toBeVisible();
  await expect(grantRow).toContainText("Global");

  const revokeResponse = page.waitForResponse(
    (response) =>
      /^\/api\/v1\/permissions\/grants\/[^/]+$/.test(new URL(response.url()).pathname) &&
      response.request().method() === "DELETE",
  );
  await runRowAction(page, grantRow, "Revoke grant");
  await acceptConfirmDialog(page, "Revoke grant");
  expect((await revokeResponse).status()).toBe(200);
  await expect(grantRow).toHaveCount(0);
});
