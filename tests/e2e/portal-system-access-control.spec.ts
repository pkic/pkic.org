/**
 * @covers authority.9.11
 */
import { runRowAction } from "./helpers/data-table";
import { expect, test } from "@playwright/test";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { signInToPortal } from "./helpers/portal-auth";
import { acceptConfirmDialog } from "./helpers/confirm-dialog";
import { tab } from "./helpers/tabs";
import { permissionTargetsListResponseSchema, userRoleAssignSchema } from "../../assets/shared/schemas/access-control";

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
  await page
    .getByRole("complementary", { name: "Portal navigation" })
    .getByRole("link", { name: "Access control", exact: true })
    .click();
  await expect(page).toHaveURL(/\/portal\/#\/settings\/access-control\/grants$/);

  // Tabs are URL-addressed — switching to Roles navigates to its canonical URL.
  await tab(page, "Roles").click();
  await expect(page).toHaveURL(/\/portal\/#\/settings\/access-control\/roles$/);

  // Creation lives behind an explicit action, list-first — no inline create form.
  await expect(page.getByText("New role", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "New role" }).click();
  await expect(page).toHaveURL(/\/portal\/#\/settings\/access-control\/roles\/new$/);

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
  await expect(page).toHaveURL(/\/portal\/#\/settings\/access-control\/roles\/[^/]+$/);
  await expect(page.getByRole("heading", { name: roleName, level: 3 })).toBeVisible();

  await page.screenshot({ path: test.info().outputPath("role-profile-header.png"), fullPage: true });

  // The role's edit is reachable from its detail, guarded by the shared PATCH contract.
  await page.getByRole("button", { name: "Role actions" }).click();
  await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
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

  await page
    .getByRole("navigation", { name: "Access control sections" })
    .getByRole("link", { name: "Roles", exact: true })
    .click();
  await expect(page).toHaveURL(/\/portal\/#\/settings\/access-control\/roles$/);

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

  // Keep assignment history on a separate role: previously assigned roles cannot be deleted.
  await page.getByRole("button", { name: "New role" }).click();
  await createCard.getByLabel("Name").fill(`${roleName}_event`);
  await createCard.getByRole("button", { name: "Create role" }).click();
  await expect(page.getByRole("heading", { name: `${roleName}_event`, level: 3 })).toBeVisible();

  const assignForm = page.getByRole("form", { name: "Assign this role" });
  const staffEmail = e2eAdminEmail("portal-access-control");
  await assignForm.getByLabel("Search for a user").fill(staffEmail);
  await page
    .getByRole("group", { name: "Matching users" })
    .getByRole("button", { name: new RegExp(staffEmail) })
    .click();
  const targetsResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname === `${PERMISSIONS_API}/targets` &&
      url.searchParams.get("contextType") === "event" &&
      !url.searchParams.has("q")
    );
  });
  await assignForm.getByLabel("Target", { exact: true }).selectOption("event");
  const targets = await targetsResponse;
  expect(targets.status()).toBe(200);
  const { targets: events } = permissionTargetsListResponseSchema.parse(await targets.json());
  expect(events.length).toBeGreaterThan(0);
  const event = events.find((target) => target.id.startsWith("event-meeting-"));
  expect(event, "migration-seeded meeting events are selectable").toBeDefined();
  if (!event) throw new Error("The migrated meeting fixture is missing");
  const eventPicker = assignForm.getByRole("combobox", { name: "Event", exact: true });
  await eventPicker.click();
  await expect(page.getByRole("option", { name: event.name, exact: true })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("event-role-picker.png"), fullPage: true });
  await eventPicker.fill("no-such-event-for-role-assignment");
  await expect(page.getByRole("status").filter({ hasText: "No matches for" })).toBeVisible();
  await eventPicker.fill("");
  await expect(page.getByRole("option", { name: event.name, exact: true })).toBeVisible();
  await page.getByRole("option", { name: event.name, exact: true }).click();
  const assignmentResponse = page.waitForResponse(
    (response) =>
      /^\/api\/v1\/users\/[^/]+\/roles$/.test(new URL(response.url()).pathname) &&
      response.request().method() === "POST",
  );
  await assignForm.getByRole("button", { name: "Assign", exact: true }).click();
  const assignment = await assignmentResponse;
  expect(assignment.status()).toBe(201);
  expect(userRoleAssignSchema.parse(assignment.request().postDataJSON())).toMatchObject({
    contextType: "event",
    contextId: event.id,
  });
  await expect(page.getByText("Role assigned", { exact: true })).toBeVisible();
  await page.reload();
  const assignmentRow = page.getByRole("row").filter({ hasText: staffEmail });
  await expect(assignmentRow).toContainText(`event:${event.id}`);
  await runRowAction(page, assignmentRow, "Unassign role");
  await acceptConfirmDialog(page, "Unassign role");
  await expect(assignmentRow).toHaveCount(0);

  // The former "Staff" tab is now labeled People, without renaming the
  // underlying user_roles-backed schema fields it reads and writes.
  await tab(page, "People").click();
  await expect(page).toHaveURL(/\/portal\/#\/settings\/access-control\/people$/);
  await expect(page.getByText("Staff management", { exact: true })).toHaveCount(0);

  await page.goto("/portal/#/settings/access-control");
  await expect(page).toHaveURL(/\/portal\/#\/settings\/access-control\/grants$/);
  await expect(
    page
      .getByRole("navigation", { name: "Access control navigation" })
      .getByRole("link", { name: "Access control", exact: true }),
  ).toBeVisible();

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
  await page.goto("/portal/#/settings/access-control/grants");

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
